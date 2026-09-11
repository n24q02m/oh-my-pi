import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type { PairingApprovalResult, PairingBeginResult, PairingClaimResult, PairingPendingMetadata } from "./protocol";

import type {
	DaemonCapability,
	PairedDeviceMetadata,
	PairedDeviceRecord,
	PairingApprovalResult,
	PairingBeginResult,
	PairingClaimResult,
	PairingPendingMetadata,
} from "./protocol";

const PERSISTENCE_VERSION = 1;
const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1_000;
const MAX_PENDING_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_PENDING = 32;
const DEFAULT_MAX_DEVICES = 64;
const MAX_NAME_LENGTH = 64;
const TOKEN_BYTES = 32;
const CODE_BYTES = 12;
const HASH_HEX_LENGTH = 64;
const PERSISTENCE_FILE = "paired-devices.json";

const CAPABILITIES: readonly DaemonCapability[] = [
	"observe",
	"control-session",
	"approve",
	"manage-devices",
	"git-read",
];
const CAPABILITY_SET = new Set<DaemonCapability>(CAPABILITIES);

interface PendingPairing {
	name: string;
	capabilities: DaemonCapability[];
	createdAt: number;
	expiresAt: number;
	approvedAt?: number;
}

type RandomBytesSource = (size: number) => Buffer;

export interface PairingStoreOptions {
	/** Path to the private hash-only pairing state file. */
	filePath?: string;
	/** Runtime directory used when filePath is omitted. */
	runtimeDir?: string;
	/** Secret used as the HMAC key; only its hash output is persisted. */
	secret: string;
	/** Injectable clock for deterministic expiry tests. */
	now?: () => number;
	/** Injectable cryptographic byte source for deterministic tests. */
	randomBytes?: RandomBytesSource;
	/** Lifetime of a pending code; always bounded to a short maximum. */
	pendingTtlMs?: number;
	/** Maximum number of pending enrollment requests retained in memory. */
	maxPending?: number;
	/** Maximum number of paired devices retained on disk. */
	maxDevices?: number;
}

export interface PairedDeviceAuthentication {
	id: string;
	name: string;
	capabilities: DaemonCapability[];
	lastSeenAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function invalidPersistence(message: string): Error {
	return new Error(`Pairing persistence is corrupt: ${message}`);
}

function cloneCapabilities(capabilities: readonly DaemonCapability[]): DaemonCapability[] {
	return [...capabilities];
}

function metadata(record: PairedDeviceRecord): PairedDeviceMetadata {
	return {
		id: record.id,
		name: record.name,
		capabilities: cloneCapabilities(record.capabilities),
		createdAt: record.createdAt,
		rotatedAt: record.rotatedAt,
		lastSeenAt: record.lastSeenAt,
	};
}

function pendingMetadata(pending: PendingPairing): PairingPendingMetadata {
	return {
		name: pending.name,
		capabilities: cloneCapabilities(pending.capabilities),
		createdAt: pending.createdAt,
		expiresAt: pending.expiresAt,
	};
}

function validateFiniteTimestamp(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw invalidPersistence(`${label} must be a non-negative finite number`);
	}
	return value;
}

function validateName(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME_LENGTH) {
		throw invalidPersistence(`${label} must be 1-${MAX_NAME_LENGTH} characters`);
	}
	if (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw invalidPersistence(`${label} contains invalid characters`);
	}
	return value;
}

function normalizeCapabilities(value: readonly DaemonCapability[]): DaemonCapability[] {
	if (value.length === 0) throw new Error("Pairing capabilities must not be empty");
	const unique = new Set<DaemonCapability>();
	for (const capability of value) {
		if (!CAPABILITY_SET.has(capability)) throw new Error(`Unknown daemon capability: ${capability}`);
		unique.add(capability);
	}
	return CAPABILITIES.filter(capability => unique.has(capability));
}

function validatePersistedCapabilities(value: unknown): DaemonCapability[] {
	if (!Array.isArray(value) || value.length === 0)
		throw invalidPersistence("device capabilities must be a non-empty array");
	try {
		return normalizeCapabilities(value as DaemonCapability[]);
	} catch (error) {
		throw invalidPersistence(error instanceof Error ? error.message : String(error));
	}
}

function validateHash(value: unknown, label: string): string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
		throw invalidPersistence(`${label} must be a lowercase SHA-256 HMAC`);
	}
	return value;
}

function parseDevice(value: unknown): PairedDeviceRecord {
	if (!isRecord(value)) throw invalidPersistence("device must be an object");
	const id = validateName(value.id, "device id");
	const name = validateName(value.name, "device name");
	const tokenHash = validateHash(value.tokenHash, "device tokenHash");
	const capabilities = validatePersistedCapabilities(value.capabilities);
	const createdAt = validateFiniteTimestamp(value.createdAt, "device createdAt");
	const rotatedAt =
		value.rotatedAt === undefined ? undefined : validateFiniteTimestamp(value.rotatedAt, "device rotatedAt");
	const lastSeenAt =
		value.lastSeenAt === undefined ? undefined : validateFiniteTimestamp(value.lastSeenAt, "device lastSeenAt");
	return { id, name, tokenHash, capabilities, createdAt, rotatedAt, lastSeenAt };
}

function parseState(value: unknown): PairedDeviceRecord[] {
	if (!isRecord(value)) throw invalidPersistence("root must be an object");
	if (value.version !== PERSISTENCE_VERSION) throw invalidPersistence("unsupported version");
	if (!Array.isArray(value.devices)) throw invalidPersistence("devices must be an array");
	const devices = value.devices.map(parseDevice);
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const device of devices) {
		if (ids.has(device.id)) throw invalidPersistence("duplicate device id");
		if (names.has(device.name)) throw invalidPersistence("duplicate device name");
		ids.add(device.id);
		names.add(device.name);
	}
	return devices;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Persistent, capability-scoped device enrollment state for one daemon broker. */
export class PairingStore {
	readonly #filePath: string;
	readonly #secret: string;
	readonly #now: () => number;
	readonly #randomBytes: RandomBytesSource;
	readonly #pendingTtlMs: number;
	readonly #maxPending: number;
	readonly #maxDevices: number;
	readonly #pending = new Map<string, PendingPairing>();
	#devices: PairedDeviceRecord[] = [];
	#loaded = false;
	#loadError: Error | undefined;
	#persistenceFailed = false;
	#queue: Promise<unknown> = Promise.resolve();

	constructor(options: PairingStoreOptions) {
		if (typeof options.secret !== "string" || options.secret.length === 0) {
			throw new Error("Pairing store secret must be non-empty");
		}
		const filePath = options.filePath ?? path.join(options.runtimeDir ?? ".", PERSISTENCE_FILE);
		this.#filePath = path.resolve(filePath);
		this.#secret = options.secret;
		this.#now = options.now ?? Date.now;
		this.#randomBytes = options.randomBytes ?? randomBytes;
		const requestedTtl = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
		if (!Number.isFinite(requestedTtl) || requestedTtl <= 0) throw new Error("Pairing pendingTtlMs must be positive");
		this.#pendingTtlMs = Math.min(requestedTtl, MAX_PENDING_TTL_MS);
		this.#maxPending = this.#boundedLimit(options.maxPending ?? DEFAULT_MAX_PENDING, "maxPending");
		this.#maxDevices = this.#boundedLimit(options.maxDevices ?? DEFAULT_MAX_DEVICES, "maxDevices");
	}

	/** Load and validate durable records before a broker starts accepting requests. */
	initialize(): Promise<void> {
		return this.#enqueue(async () => {
			if (this.#loadError) throw this.#loadError;
			if (this.#loaded) return;
			try {
				const fileStat = await fs.lstat(this.#filePath);
				if (
					!fileStat.isFile() ||
					fileStat.isSymbolicLink() ||
					(process.platform !== "win32" && (fileStat.mode & 0o077) !== 0)
				)
					throw invalidPersistence("state file must be a private regular file");
				const raw = await fs.readFile(this.#filePath, "utf8");
				this.#devices = parseState(JSON.parse(raw) as unknown);
				if (this.#devices.length > this.#maxDevices) {
					throw invalidPersistence(`device count exceeds ${this.#maxDevices}`);
				}
			} catch (error) {
				if (isMissingFile(error)) {
					this.#devices = [];
				} else {
					const failure =
						error instanceof Error && error.message.startsWith("Pairing persistence is corrupt")
							? error
							: invalidPersistence(errorMessage(error));
					this.#loadError = failure;
					throw failure;
				}
			}
			this.#loaded = true;
		});
	}

	/** Wait for all queued mutations to settle. */
	flush(): Promise<void> {
		return this.#enqueue(async () => undefined);
	}

	/** Begin a short-lived enrollment; only the HMAC is retained in memory. */
	begin(
		name: string,
		capabilities: readonly DaemonCapability[],
		ttlMs = this.#pendingTtlMs,
	): Promise<PairingBeginResult> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			this.#pruneExpired();
			const normalizedName = this.#validateEnrollmentName(name);
			const normalizedCapabilities = normalizeCapabilities(capabilities);
			const boundedTtlMs = this.#boundedTtl(ttlMs);
			if (this.#devices.length >= this.#maxDevices) throw new Error("Paired device limit reached");
			if (this.#pending.size >= this.#maxPending) throw new Error("Pairing pending request limit reached");
			if (this.#devices.some(device => device.name === normalizedName)) {
				throw new Error(`Pairing device name ${normalizedName} is already in use`);
			}
			for (const pending of this.#pending.values()) {
				if (pending.name === normalizedName)
					throw new Error(`Pairing device name ${normalizedName} is already pending`);
			}
			const createdAt = this.#now();
			const expiresAt = createdAt + boundedTtlMs;
			const code = this.#newSecret(CODE_BYTES);
			this.#pending.set(this.#hash(code), {
				name: normalizedName,
				capabilities: normalizedCapabilities,
				createdAt,
				expiresAt,
			});
			return {
				code,
				name: normalizedName,
				capabilities: cloneCapabilities(normalizedCapabilities),
				createdAt,
				expiresAt,
			};
		});
	}

	/** Approve a pending enrollment from the foreground host. */
	approve(code: string): Promise<PairingApprovalResult> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			this.#pruneExpired();
			const hash = this.#hash(code);
			const pending = this.#pending.get(hash);
			if (!pending) throw new Error("Pairing code is unknown or expired");
			const approvedAt = this.#now();
			pending.approvedAt = approvedAt;
			return {
				name: pending.name,
				capabilities: cloneCapabilities(pending.capabilities),
				createdAt: pending.createdAt,
				expiresAt: pending.expiresAt,
				approvedAt,
			};
		});
	}

	/** Preview pending enrollment metadata without exposing the one-time code. */
	preview(code: string): Promise<PairingPendingMetadata> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			this.#pruneExpired();
			const pending = this.#pending.get(this.#hash(code));
			if (!pending) throw new Error("Pairing code is unknown or expired");
			return pendingMetadata(pending);
		});
	}

	/** Remove only one pending enrollment; enrolled devices remain untouched. */
	deny(code: string): Promise<PairingPendingMetadata> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			this.#pruneExpired();
			const hash = this.#hash(code);
			const pending = this.#pending.get(hash);
			if (!pending) throw new Error("Pairing code is unknown or expired");
			const result = pendingMetadata(pending);
			this.#pending.delete(hash);
			return result;
		});
	}

	/** Claim an approved enrollment and return the raw device token exactly once. */
	claim(code: string): Promise<PairingClaimResult> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			this.#pruneExpired();
			const hash = this.#hash(code);
			const pending = this.#pending.get(hash);
			if (!pending) throw new Error("Pairing code is unknown or expired");
			if (pending.approvedAt === undefined) throw new Error("Pairing code requires foreground approval");
			if (this.#devices.length >= this.#maxDevices) throw new Error("Paired device limit reached");
			const createdAt = this.#now();
			const token = this.#newSecret(TOKEN_BYTES);
			const record: PairedDeviceRecord = {
				id: this.#newId(),
				name: pending.name,
				tokenHash: this.#hash(token),
				capabilities: cloneCapabilities(pending.capabilities),
				createdAt,
			};
			const nextDevices = [...this.#devices, record];
			await this.#persistAndCommit(nextDevices);
			this.#pending.delete(hash);
			return { device: metadata(record), token };
		});
	}

	/** Return metadata only; hashes and credentials never cross this boundary. */
	list(): Promise<PairedDeviceMetadata[]> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			return this.#devices.map(metadata);
		});
	}

	/** Revoke one paired device and persist the removal before returning. */
	revoke(id: string): Promise<void> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			const existing = this.#devices.find(device => device.id === id);
			if (!existing) throw new Error(`Unknown paired device ${id}`);
			await this.#persistAndCommit(this.#devices.filter(device => device.id !== id));
		});
	}

	/** Rotate one device credential; the previous hash is replaced before returning the new token. */
	rotate(id: string): Promise<PairingClaimResult> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			const existing = this.#devices.find(device => device.id === id);
			if (!existing) throw new Error(`Unknown paired device ${id}`);
			const token = this.#newSecret(TOKEN_BYTES);
			const rotated: PairedDeviceRecord = {
				...existing,
				tokenHash: this.#hash(token),
				rotatedAt: this.#now(),
			};
			await this.#persistAndCommit(this.#devices.map(device => (device.id === id ? rotated : device)));
			return { device: metadata(rotated), token };
		});
	}

	/** Authenticate a device token and update its last-seen timestamp durably. */
	authenticate(token: string): Promise<PairedDeviceAuthentication | undefined> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			const hash = this.#hash(token);
			const existing = this.#devices.find(device => this.#sameHash(device.tokenHash, hash));
			if (!existing) return undefined;
			const lastSeenAt = this.#now();
			if (existing.lastSeenAt !== lastSeenAt) {
				const updated = { ...existing, lastSeenAt };
				await this.#persistAndCommit(this.#devices.map(device => (device.id === existing.id ? updated : device)));
				return {
					id: updated.id,
					name: updated.name,
					capabilities: cloneCapabilities(updated.capabilities),
					lastSeenAt: updated.lastSeenAt,
				};
			}
			return {
				id: existing.id,
				name: existing.name,
				capabilities: cloneCapabilities(existing.capabilities),
				lastSeenAt: existing.lastSeenAt,
			};
		});
	}

	pendingCount(): Promise<number> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			this.#pruneExpired();
			return this.#pending.size;
		});
	}

	deviceCount(): Promise<number> {
		return this.#enqueue(async () => {
			this.#ensureReady();
			return this.#devices.length;
		});
	}

	#boundedTtl(value: number): number {
		if (!Number.isFinite(value) || value <= 0) throw new Error("Pairing ttlMs must be positive");
		return Math.min(value, MAX_PENDING_TTL_MS);
	}

	#boundedLimit(value: number, label: string): number {
		if (!Number.isInteger(value) || value < 1 || value > 1_024)
			throw new Error(`Pairing ${label} must be an integer from 1 to 1024`);
		return value;
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#queue.then(operation, operation);
		this.#queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	#ensureReady(): void {
		if (this.#loadError) throw this.#loadError;
		if (this.#persistenceFailed) throw new Error("Pairing persistence is unavailable; refusing to continue");
		if (!this.#loaded) throw new Error("Pairing store has not been initialized");
	}

	#validateEnrollmentName(name: string): string {
		if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_LENGTH) {
			throw new Error(`Pairing device name must be 1-${MAX_NAME_LENGTH} characters`);
		}
		if (name.trim() !== name || /[\u0000-\u001f\u007f]/u.test(name))
			throw new Error("Pairing device name contains invalid characters");
		return name;
	}

	#pruneExpired(): void {
		const now = this.#now();
		for (const [hash, pending] of this.#pending) {
			if (pending.expiresAt <= now) this.#pending.delete(hash);
		}
	}

	#newSecret(bytes: number): string {
		return this.#randomBytes(bytes).toString("base64url");
	}

	#newId(): string {
		return this.#newSecret(16);
	}

	#hash(value: string): string {
		return createHmac("sha256", this.#secret).update(value, "utf8").digest("hex");
	}

	#sameHash(first: string, second: string): boolean {
		const firstBytes = Buffer.from(first, "hex");
		const secondBytes = Buffer.from(second, "hex");
		return (
			firstBytes.length === secondBytes.length &&
			firstBytes.length === HASH_HEX_LENGTH / 2 &&
			timingSafeEqual(firstBytes, secondBytes)
		);
	}

	async #persistAndCommit(nextDevices: PairedDeviceRecord[]): Promise<void> {
		try {
			await this.#persist(nextDevices);
		} catch (error) {
			this.#persistenceFailed = true;
			throw new Error(`Pairing persistence write failed: ${errorMessage(error)}`);
		}
		this.#devices = nextDevices;
	}

	async #persist(devices: PairedDeviceRecord[]): Promise<void> {
		const parent = path.dirname(this.#filePath);
		await fs.mkdir(parent, { recursive: true, mode: 0o700 });
		if (process.platform !== "win32") {
			await fs.chmod(parent, 0o700);
			const parentStat = await fs.lstat(parent);
			if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) !== 0) {
				throw new Error("pairing persistence parent must be a private directory");
			}
		}
		const tempPath = `${this.#filePath}.${process.pid}.${this.#newId()}.tmp`;
		let handle: fs.FileHandle | undefined;
		try {
			handle = await fs.open(tempPath, "wx", 0o600);
			await handle.writeFile(JSON.stringify({ version: PERSISTENCE_VERSION, devices }), "utf8");
			await handle.sync();
			await handle.close();
			handle = undefined;
			await fs.rename(tempPath, this.#filePath);
			if (process.platform !== "win32") await fs.chmod(this.#filePath, 0o600);
		} finally {
			await handle?.close().catch(() => undefined);
			await fs.rm(tempPath, { force: true }).catch(() => undefined);
		}
	}
}
