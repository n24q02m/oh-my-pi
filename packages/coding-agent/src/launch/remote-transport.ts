import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as net from "node:net";
import * as tls from "node:tls";
import {
	type DaemonNativeRemoteTarget,
	type DaemonNativeServerOptions,
	parseDaemonNativeRemoteTarget,
	parseDaemonNativeServerOptions,
} from "./protocol";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_GLOBAL_ATTEMPT_LIMIT = 64;
const DEFAULT_SOURCE_ATTEMPT_LIMIT = 16;
const DEFAULT_ATTEMPT_WINDOW_MS = 60_000;
const DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_TLS_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BUCKETS = 1_024;
const SOURCE_BUCKET_SWEEP_MS = 60_000;
const NOFOLLOW_FLAG = (fs.constants as Record<string, number>).O_NOFOLLOW ?? 0;

const TLS_VALIDATION_ERRORS = new Set([
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"CERT_REVOKED",
	"CERT_UNTRUSTED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export interface DaemonNativeAttemptLimits {
	globalMaxAttempts?: number;
	sourceMaxAttempts?: number;
	windowMs?: number;
}

export interface DaemonNativeRemoteServer {
	readonly server: net.Server;
	readonly target: DaemonNativeRemoteTarget;
	readonly fingerprint256?: string;
	readonly discovery: {
		readonly target: DaemonNativeRemoteTarget;
		readonly fingerprint256?: string;
	};
	close(): Promise<void>;
}

export interface DaemonNativeRemoteServerCreateOptions {
	limits?: DaemonNativeAttemptLimits;
}

export interface DaemonNativeRemoteConnectOptions {
	fingerprint256?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

function normalizeFingerprint(value: string): string {
	return value.replaceAll(":", "").toUpperCase();
}

function certificateFingerprint256(certificate: Buffer | string): string {
	const parsed = new crypto.X509Certificate(certificate);
	const digest = crypto.createHash("sha256").update(parsed.raw).digest("hex").toUpperCase();
	return digest.match(/.{2}/gu)?.join(":") ?? digest;
}

function sourceAddress(socket: net.Socket): string {
	return socket.remoteAddress ?? "unknown";
}

function privateFileModeIsSafe(stat: fs.Stats): boolean {
	if (process.platform === "win32") return false;
	if (!stat.isFile()) return false;
	return (stat.mode & 0o077) === 0;
}

async function readBoundedFile(filePath: string, label: string, privateFile: boolean): Promise<Buffer> {
	if (!filePath) throw new Error(`Native TLS ${label} path is required`);
	if (process.platform === "win32") {
		throw new Error("Native TLS certificate/private-key file safety cannot be verified safely on Windows");
	}
	let handle: fs.promises.FileHandle | undefined;
	try {
		handle = await fsp.open(filePath, fs.constants.O_RDONLY | NOFOLLOW_FLAG);
		const stat = await handle.stat();
		if (!stat.isFile()) throw new Error(`Native TLS ${label} must be a regular file`);
		if (privateFile && !privateFileModeIsSafe(stat)) {
			throw new Error("Native TLS private key must not be readable by group or other users");
		}
		if (stat.size > MAX_TLS_FILE_BYTES) throw new Error(`Native TLS ${label} exceeds the 4 MiB limit`);
		const buffer = Buffer.allocUnsafe(MAX_TLS_FILE_BYTES + 1);
		let offset = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
			if (offset > MAX_TLS_FILE_BYTES) throw new Error(`Native TLS ${label} exceeds the 4 MiB limit`);
		}
		return buffer.subarray(0, offset);
	} catch (error) {
		if (error instanceof Error && /^Native TLS /u.test(error.message)) throw error;
		throw new Error(
			`Native TLS ${label} is not safely readable: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

class AttemptLimiter {
	readonly #globalMaxAttempts: number;
	readonly #sourceMaxAttempts: number;
	readonly #windowMs: number;
	readonly #globalAttempts: number[] = [];
	readonly #sourceAttempts = new Map<string, number[]>();
	readonly #sweepTimer: NodeJS.Timeout;
	#closed = false;

	constructor(options: DaemonNativeAttemptLimits = {}) {
		this.#globalMaxAttempts = boundedLimit(options.globalMaxAttempts, DEFAULT_GLOBAL_ATTEMPT_LIMIT);
		this.#sourceMaxAttempts = boundedLimit(options.sourceMaxAttempts, DEFAULT_SOURCE_ATTEMPT_LIMIT);
		this.#windowMs = boundedWindow(options.windowMs, DEFAULT_ATTEMPT_WINDOW_MS);
		this.#sweepTimer = setInterval(() => this.#prune(Date.now()), Math.min(this.#windowMs, SOURCE_BUCKET_SWEEP_MS));
		this.#sweepTimer.unref();
	}

	allow(source: string, now = Date.now()): boolean {
		if (this.#closed) return false;
		this.#prune(now);
		const sourceAttempts = this.#sourceAttempts.get(source) ?? [];
		if (this.#globalAttempts.length >= this.#globalMaxAttempts || sourceAttempts.length >= this.#sourceMaxAttempts) {
			return false;
		}
		this.#globalAttempts.push(now);
		sourceAttempts.push(now);
		if (!this.#sourceAttempts.has(source) && this.#sourceAttempts.size >= MAX_SOURCE_BUCKETS) {
			const oldest = this.#sourceAttempts.keys().next().value;
			if (oldest !== undefined) this.#sourceAttempts.delete(oldest);
		}
		this.#sourceAttempts.set(source, sourceAttempts);
		return true;
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		clearInterval(this.#sweepTimer);
		this.#globalAttempts.length = 0;
		this.#sourceAttempts.clear();
	}

	#prune(now: number): void {
		const cutoff = now - this.#windowMs;
		while (this.#globalAttempts[0] !== undefined && this.#globalAttempts[0] <= cutoff) this.#globalAttempts.shift();
		for (const [source, attempts] of this.#sourceAttempts) {
			while (attempts[0] !== undefined && attempts[0] <= cutoff) attempts.shift();
			if (attempts.length === 0) this.#sourceAttempts.delete(source);
		}
	}
}

function boundedLimit(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? Math.min(value, 10_000) : fallback;
}

function boundedWindow(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? Math.min(value, 86_400_000) : fallback;
}

function closeServer(server: net.Server): Promise<void> {
	if (!server.listening) return Promise.resolve();
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	server.close(error => (error ? reject(error) : resolve()));
	return promise;
}

function createConnectionWithTimeout(
	connect: () => net.Socket,
	readyEvent: "connect" | "secureConnect",
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<net.Socket> {
	const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
	let socket: net.Socket;
	try {
		socket = connect();
	} catch (error) {
		reject(error instanceof Error ? error : new Error(String(error)));
		return promise;
	}
	let settled = false;
	const finish = (error?: Error): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		socket.off(readyEvent, onReady);
		socket.off("error", onError);
		socket.off("close", onClose);
		signal?.removeEventListener("abort", onAbort);
		if (error) {
			socket.destroy();
			reject(error);
		} else {
			resolve(socket);
		}
	};
	const onReady = (): void => finish();
	const onError = (error: Error): void => finish(error);
	const onClose = (): void => finish(new Error("Native remote socket closed before connection completed"));
	const onAbort = (): void => finish(new Error("Native remote connection aborted"));
	const timer = setTimeout(() => finish(new Error("Timed out connecting to native daemon remote target")), timeoutMs);
	socket.once(readyEvent, onReady);
	socket.once("error", onError);
	socket.once("close", onClose);
	if (signal?.aborted) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	return promise;
}

function isTlsValidationError(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && "code" in error && TLS_VALIDATION_ERRORS.has(String(error.code))
	);
}

function targetServerName(target: DaemonNativeRemoteTarget): string | undefined {
	return net.isIP(target.host) === 0 ? target.host : undefined;
}

async function connectTls(
	target: Extract<DaemonNativeRemoteTarget, { transport: "tls" }>,
	rejectUnauthorized: boolean,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<net.Socket> {
	return createConnectionWithTimeout(
		() =>
			tls.connect({
				host: target.host,
				port: target.port,
				servername: targetServerName(target),
				rejectUnauthorized,
			}),
		"secureConnect",
		timeoutMs,
		signal,
	);
}

/** Connect to a native TCP/TLS endpoint; a configured pin is only used after ordinary TLS validation fails. */
export async function connectDaemonNativeRemote(
	value: DaemonNativeRemoteTarget | string,
	options: DaemonNativeRemoteConnectOptions = {},
): Promise<net.Socket> {
	const target = parseDaemonNativeRemoteTarget(value);
	const timeoutMs = boundedWindow(options.timeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
	if (target.transport === "tcp") {
		return createConnectionWithTimeout(
			() => net.connect({ host: target.host, port: target.port }),
			"connect",
			timeoutMs,
			options.signal,
		);
	}
	const fingerprint = options.fingerprint256 ?? target.fingerprint256;
	try {
		return await connectTls(target, true, timeoutMs, options.signal);
	} catch (error) {
		if (!fingerprint || !isTlsValidationError(error)) throw error;
	}
	const pinned = await connectTls(target, false, timeoutMs, options.signal);
	const peer = (pinned as tls.TLSSocket).getPeerCertificate(true);
	const raw = peer && typeof peer === "object" && "raw" in peer ? peer.raw : undefined;
	if (!Buffer.isBuffer(raw)) {
		pinned.destroy();
		throw new Error("Native TLS peer did not provide a certificate");
	}
	const actual = normalizeFingerprint(certificateFingerprint256(raw));
	if (actual !== normalizeFingerprint(fingerprint)) {
		pinned.destroy();
		throw new Error("Native TLS certificate fingerprint mismatch");
	}
	return pinned;
}

/** Start a native TCP/TLS listener and expose only non-secret certificate discovery metadata. */
export async function createDaemonNativeServer(
	value: DaemonNativeServerOptions,
	onConnection: (socket: net.Socket) => void,
	options: DaemonNativeRemoteServerCreateOptions = {},
): Promise<DaemonNativeRemoteServer> {
	const serverOptions = parseDaemonNativeServerOptions(value);
	const limiter = new AttemptLimiter(options.limits);
	const sockets = new Set<net.Socket>();
	const admittedTlsSockets = new Set<net.Socket>();
	const trackSocket = (socket: net.Socket): void => {
		if (sockets.has(socket)) return;
		sockets.add(socket);
		socket.once("close", () => {
			sockets.delete(socket);
			admittedTlsSockets.delete(socket);
		});
	};
	const invokeConnection = (socket: net.Socket): void => {
		try {
			onConnection(socket);
		} catch {
			socket.destroy();
		}
	};
	const accept = (socket: net.Socket): void => {
		trackSocket(socket);
		if (!limiter.allow(sourceAddress(socket))) {
			socket.destroy();
			return;
		}
		invokeConnection(socket);
	};
	let server: net.Server | undefined;
	let fingerprint256: string | undefined;
	try {
		if (serverOptions.target.transport === "tls") {
			const cert = await readBoundedFile(serverOptions.certFile!, "certificate", false);
			const key = await readBoundedFile(serverOptions.keyFile!, "private key", true);
			fingerprint256 = certificateFingerprint256(cert);
			const tlsServer = tls.createServer(
				{ cert, key, minVersion: "TLSv1.2", handshakeTimeout: DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS },
				socket => {
					if (!admittedTlsSockets.delete(socket)) {
						socket.destroy();
						return;
					}
					socket.setTimeout(0);
					invokeConnection(socket);
				},
			);
			server = tlsServer;
			tlsServer.on("connection", socket => {
				trackSocket(socket);
				if (!limiter.allow(sourceAddress(socket))) {
					socket.destroy();
					return;
				}
				admittedTlsSockets.add(socket);
				socket.setTimeout(DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS, () => socket.destroy());
			});
			tlsServer.on("tlsClientError", (_error, socket) => socket.destroy());
		} else {
			server = net.createServer(socket => accept(socket));
		}
		const listeningServer = server;
		const { promise: listening, resolve, reject } = Promise.withResolvers<void>();
		const onError = (error: Error): void => {
			listeningServer.off("listening", onListening);
			reject(error);
		};
		const onListening = (): void => {
			listeningServer.off("error", onError);
			resolve();
		};
		listeningServer.once("error", onError);
		listeningServer.once("listening", onListening);
		listeningServer.listen({ host: serverOptions.target.host, port: serverOptions.target.port });
		await listening;
	} catch (error) {
		limiter.close();
		for (const socket of sockets) socket.destroy();
		if (server) await closeServer(server).catch(() => undefined);
		throw error;
	}
	if (!server) {
		limiter.close();
		throw new Error("Native remote server failed to initialize");
	}
	const discoveryTarget = { ...serverOptions.target };
	const discovery =
		fingerprint256 === undefined ? { target: discoveryTarget } : { target: discoveryTarget, fingerprint256 };
	let closed = false;
	return {
		server,
		target: serverOptions.target,
		fingerprint256,
		discovery,
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			limiter.close();
			for (const socket of sockets) socket.destroy();
			await closeServer(server);
		},
	};
}

/** Return discovery data suitable for clients; authentication tokens are deliberately absent. */
export function daemonNativeServerDiscovery(server: DaemonNativeRemoteServer): DaemonNativeRemoteServer["discovery"] {
	return server.discovery;
}
