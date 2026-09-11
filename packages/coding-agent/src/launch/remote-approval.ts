import * as crypto from "node:crypto";

const DEFAULT_TTL_MS = 60_000;
const MAX_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_PENDING = 32;
const MAX_SUMMARY_LENGTH = 500;

export interface RemoteApprovalRequestInput {
	daemonName: string;
	operation: string;
	summary: string;
	ttlMs?: number;
}

export interface RemoteApprovalRequest {
	id: string;
	daemonName: string;
	operation: string;
	summary: string;
	createdAt: number;
	expiresAt: number;
}

export interface RemoteApprovalResolution {
	request: RemoteApprovalRequest;
	decision: "approve" | "deny";
	resolvedAt: number;
}

interface PendingApproval {
	request: RemoteApprovalRequest;
}

export interface RemoteApprovalRegistryOptions {
	ttlMs?: number;
	maxPending?: number;
	now?: () => number;
}

function normalizeText(value: string, label: string, maxLength: number): string {
	const normalized = value.replaceAll(/[\u0000-\u001f\u007f]+/gu, " ").replaceAll(/\s+/gu, " ").trim();
	if (normalized.length === 0) throw new Error(`${label} must be non-empty`);
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

/** In-memory approval registry with exact-id and expiry enforcement. */
export class RemoteApprovalRegistry {
	readonly #entries = new Map<string, PendingApproval>();
	readonly #ttlMs: number;
	readonly #maxPending: number;
	readonly #now: () => number;

	constructor(options: RemoteApprovalRegistryOptions = {}) {
		const requestedTtl = options.ttlMs;
		this.#ttlMs = requestedTtl !== undefined && Number.isFinite(requestedTtl) && requestedTtl > 0
			? Math.min(Math.floor(requestedTtl), MAX_TTL_MS)
			: DEFAULT_TTL_MS;
		const requestedMax = options.maxPending;
		this.#maxPending = requestedMax !== undefined && Number.isInteger(requestedMax) && requestedMax > 0
			? Math.min(requestedMax, 256)
			: DEFAULT_MAX_PENDING;
		this.#now = options.now ?? Date.now;
	}

	create(input: RemoteApprovalRequestInput): RemoteApprovalRequest {
		const now = this.#now();
		this.#purge(now);
		if (this.#entries.size >= this.#maxPending) throw new Error("Remote approval queue is full");
		const request: RemoteApprovalRequest = {
			id: crypto.randomUUID(),
			daemonName: normalizeText(input.daemonName, "approval daemonName", 96),
			operation: normalizeText(input.operation, "approval operation", 96),
			summary: normalizeText(input.summary, "approval summary", MAX_SUMMARY_LENGTH),
			createdAt: now,
			expiresAt: now + this.#ttlMs,
		};
		this.#entries.set(request.id, { request });
		return { ...request };
	}

	list(now = this.#now()): RemoteApprovalRequest[] {
		this.#purge(now);
		return [...this.#entries.values()].map(entry => ({ ...entry.request }));
	}

	get(id: string, now = this.#now()): RemoteApprovalRequest | undefined {
		this.#purge(now);
		const entry = this.#entries.get(id);
		return entry ? { ...entry.request } : undefined;
	}

	resolve(id: string, decision: "approve" | "deny", now = this.#now()): RemoteApprovalResolution {
		this.#purge(now);
		const entry = this.#entries.get(id);
		if (!entry) throw new Error("Remote approval request is missing or expired");
		if (entry.request.expiresAt <= now) {
			this.#entries.delete(id);
			throw new Error("Remote approval request is missing or expired");
		}
		this.#entries.delete(id);
		return {
			request: { ...entry.request },
			decision,
			resolvedAt: now,
		};
	}

	clear(): void {
		this.#entries.clear();
	}

	#purge(now: number): void {
		for (const [id, entry] of this.#entries) {
			if (entry.request.expiresAt <= now) this.#entries.delete(id);
		}
	}
}
