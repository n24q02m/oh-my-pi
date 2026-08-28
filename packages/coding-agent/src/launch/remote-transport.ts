import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";
import * as tls from "node:tls";
import { assertOwnerPrivateDir } from "../ssh/connection-manager";
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
const DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS = 2_000;
const DEFAULT_PENDING_HANDSHAKE_LIMIT = 64;
const MAX_TLS_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BUCKETS = 1_024;
const SOURCE_BUCKET_SWEEP_MS = 60_000;

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

const WINDOWS_ACL_TIMEOUT_MS = 5_000;
const WINDOWS_ACL_MAX_BUFFER_BYTES = 128 * 1024;
const WINDOWS_ACL_SCRIPT = `$ErrorActionPreference = 'Stop'
$specs = @($env:OMP_NATIVE_ACL_SPECS | ConvertFrom-Json)
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$systemSid = 'S-1-5-18'
$administratorsSid = 'S-1-5-32-544'
$writeMask = [System.Security.AccessControl.FileSystemRights]::WriteData -bor [System.Security.AccessControl.FileSystemRights]::AppendData -bor [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor [System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [System.Security.AccessControl.FileSystemRights]::TakeOwnership
$genericWriteMask = [int64]0x40000000
foreach ($spec in $specs) {
  $target = [string]$spec.path
  $fullTarget = [System.IO.Path]::GetFullPath($target)
  $rootPath = [System.IO.Path]::GetPathRoot($fullTarget)
  if ($rootPath.Length -ne 3 -or $rootPath[1] -ne ":" -or [int][char]$rootPath[2] -ne 92) { throw "Native Windows path must use a local drive root: $target" }
  $driveInfo = $null
  $driveType = $null
  try {
    $driveInfo = New-Object -TypeName System.IO.DriveInfo -ArgumentList $rootPath
    $driveType = $driveInfo.DriveType
  } catch {
    throw "Native Windows path volume type could not be verified: $rootPath"
  }
  if ($driveType -ne [System.IO.DriveType]::Fixed) { throw "Native Windows path must use a fixed local volume: $rootPath" }
  try {
    if (-not $driveInfo.IsReady) { throw "drive is not ready" }
  } catch {
    throw "Native Windows path volume could not be verified as a fixed local volume: $rootPath"
  }
  $relative = $fullTarget.Substring($rootPath.Length)
  $parts = @($relative -split '[\\\\/]' | Where-Object { $_ -ne '' })
  $paths = @()
  $prefix = $rootPath
  foreach ($part in $parts) {
    $prefix = [System.IO.Path]::Combine($prefix, [string]$part)
    $paths += $prefix
  }
  if ($paths.Count -eq 0) { $paths = @($rootPath) }
  $wantDirectory = [bool]$spec.directory
  $targetItem = Get-Item -LiteralPath $fullTarget -Force -ErrorAction Stop
  if ($wantDirectory -and -not $targetItem.PSIsContainer) { throw "Native path is not a directory: $target" }
  if (-not $wantDirectory -and $targetItem.PSIsContainer) { throw "Native path is not a file: $target" }
  $privateParent = [bool]$spec.privateParent
  for ($index = $paths.Count - 1; $index -ge 0; $index--) {
    $componentPath = [string]$paths[$index]
    $component = Get-Item -LiteralPath $componentPath -Force -ErrorAction Stop
    if (($component.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Native path contains a reparse point: $componentPath" }
    $acl = Get-Acl -LiteralPath $componentPath -ErrorAction Stop
    try { $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $ownerSid = [string]$acl.Owner }
    $depth = $paths.Count - 1 - $index
    $strict = ($depth -eq 0 -and [bool]$spec.privateFinal) -or ($depth -eq 1 -and $privateParent)
    if ($strict -and $ownerSid -ne $currentSid) {
      if ($depth -eq 0) { throw "Native private path is not owned by the current user: $componentPath" }
      throw "Native private parent is not owned by the current user: $componentPath"
    }
    foreach ($entry in @($acl.Access)) {
      try { $sid = $entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $sid = [string]$entry.IdentityReference.Value }
      $rights = [int64]$entry.FileSystemRights
      $write = (($rights -band $writeMask) -ne 0) -or (($rights -band $genericWriteMask) -ne 0)
      $trusted = $sid -eq $currentSid -or $sid -eq $systemSid -or $sid -eq $administratorsSid
      if ($strict) {
        if ($entry.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw "Native private path has a deny ACL: $componentPath" }
        if (-not $trusted) { throw "Native private path has an untrusted ACL entry: $componentPath" }
      } elseif ($write -and -not $trusted) {
        throw "Native path parent is writable by an untrusted principal: $componentPath"
      }
    }
  }
}
Write-Output 'OMP_NATIVE_ACL_OK'`;

interface NativePathSafetySpec {
	path: string;
	directory: boolean;
	privateFinal: boolean;
	privateParent: boolean;
}

function nativePowerShellPath(): string {
	return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function runWindowsAclProbe(specs: readonly NativePathSafetySpec[]): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	try {
		childProcess.execFile(
			nativePowerShellPath(),
			["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_ACL_SCRIPT],
			{
				env: { ...process.env, OMP_NATIVE_ACL_SPECS: JSON.stringify(specs) },
				windowsHide: true,
				timeout: WINDOWS_ACL_TIMEOUT_MS,
				maxBuffer: WINDOWS_ACL_MAX_BUFFER_BYTES,
			},
			(error, stdout, stderr) => {
				if (error) {
					const detail = stderr.trim().split(/\r?\n/u).filter(Boolean).at(-1) ?? error.message;
					reject(new Error(`Windows native path ACL verification failed: ${detail}`));
					return;
				}
				if (stdout.trim() !== "OMP_NATIVE_ACL_OK") {
					reject(new Error("Windows native path ACL verification returned an invalid result"));
					return;
				}
				resolve();
			},
		);
	} catch (error) {
		reject(error instanceof Error ? error : new Error(String(error)));
	}
	return promise;
}
function assertWindowsLocalPath(targetPath: string): void {
	const normalized = path.win32.normalize(targetPath);
	const isRootRelative = normalized.charCodeAt(0) === 92;
	if (isRootRelative) {
		throw new Error(
			"Native Windows paths must use an explicit local drive; UNC, device, and namespace roots are unsupported",
		);
	}
}

function nativeNoFollowFlag(label: string): number | undefined {
	// Windows fallback is paired with ACL/reparse preflight and post-read handle identity checks.
	const noFollowFlag = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW;
	if (noFollowFlag === undefined || noFollowFlag === 0) {
		if (process.platform === "win32") return undefined;
		throw new Error(`Native ${label} cannot be read safely: O_NOFOLLOW is unavailable on ${process.platform}`);
	}
	return noFollowFlag;
}

function assertPosixNoFollowFlag(label: string): number {
	const noFollowFlag = nativeNoFollowFlag(label);
	if (noFollowFlag === undefined) {
		throw new Error(`Native ${label} cannot use the Windows reparse-safe fallback on POSIX`);
	}
	return noFollowFlag;
}
function assertPosixDirectoryChain(directory: string, label: string, skipFinal = false): void {
	const directoryFlag = (fs.constants as Record<string, number>).O_DIRECTORY ?? 0;
	const noFollowFlag = assertPosixNoFollowFlag(`${label} path`);
	let current = path.resolve(directory);
	for (;;) {
		if (!(skipFinal && current === path.resolve(directory))) {
			let fd: number | undefined;
			try {
				fd = fs.openSync(current, fs.constants.O_RDONLY | directoryFlag | noFollowFlag);
				const stat = fs.fstatSync(fd);
				if (!stat.isDirectory()) throw new Error(`Native ${label} parent is not a directory: ${current}`);
				const mode = stat.mode & 0o7777;
				if ((mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
					throw new Error(`Native ${label} parent is writable by group or other users: ${current}`);
				}
			} catch (error) {
				if (error instanceof Error && /^Native /u.test(error.message)) throw error;
				throw new Error(
					`Native ${label} parent is not safely accessible: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				if (fd !== undefined) fs.closeSync(fd);
			}
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
}

/** Validate the target and every existing parent before reading a native secret or key. */
export async function assertNativePathSafe(
	targetPath: string,
	options: { directory?: boolean; privateFinal?: boolean; privateParent?: boolean } = {},
): Promise<void> {
	if (!targetPath) throw new Error("Native path is required");
	const directory = options.directory === true;
	const privateFinal = options.privateFinal === true;
	const privateParent = options.privateParent === true;
	if (process.platform === "win32") {
		assertWindowsLocalPath(targetPath);
		await runWindowsAclProbe([{ path: path.resolve(targetPath), directory, privateFinal, privateParent }]);
		return;
	}
	const finalDirectory = directory ? path.resolve(targetPath) : path.dirname(path.resolve(targetPath));
	if ((directory && privateFinal) || (!directory && privateParent)) assertOwnerPrivateDir(finalDirectory);
	assertPosixDirectoryChain(finalDirectory, "path", (directory && privateFinal) || (!directory && privateParent));
}
export interface DaemonNativeAttemptLimits {
	globalMaxAttempts?: number;
	sourceMaxAttempts?: number;
	windowMs?: number;
	pendingHandshakeMax?: number;
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
	if (!stat.isFile()) return false;
	if (process.platform === "win32") return true;
	return (stat.mode & 0o077) === 0;
}

async function readBoundedFile(filePath: string, label: string, privateFile: boolean): Promise<Buffer> {
	if (!filePath) throw new Error(`Native TLS ${label} path is required`);
	await assertNativePathSafe(filePath, { privateFinal: privateFile, privateParent: true });
	let handle: fs.promises.FileHandle | undefined;
	try {
		const noFollowFlag = nativeNoFollowFlag(`TLS ${label}`);
		let openFlags = fs.constants.O_RDONLY;
		if (noFollowFlag !== undefined) openFlags |= noFollowFlag;
		handle = await fsp.open(filePath, openFlags);
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
		const currentStat = await fsp.stat(filePath);
		if (currentStat.dev !== stat.dev || currentStat.ino !== stat.ino) {
			throw new Error(`Native TLS ${label} path changed while reading`);
		}
		await assertNativePathSafe(filePath, { privateFinal: privateFile, privateParent: true });
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

class PendingHandshakeLimiter {
	readonly #max: number;
	readonly #sockets = new Set<net.Socket>();
	#closed = false;

	constructor(options: DaemonNativeAttemptLimits = {}) {
		this.#max = boundedLimit(options.pendingHandshakeMax, DEFAULT_PENDING_HANDSHAKE_LIMIT);
	}

	acquire(socket: net.Socket): boolean {
		if (this.#closed || this.#sockets.size >= this.#max) return false;
		this.#sockets.add(socket);
		return true;
	}

	release(socket: net.Socket): boolean {
		return this.#sockets.delete(socket);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#sockets.clear();
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
	const pendingHandshakes = new PendingHandshakeLimiter(options.limits);
	const tlsHandshakeTimers = new Map<net.Socket, NodeJS.Timeout>();
	const clearTlsHandshakeTimer = (socket: net.Socket): void => {
		const timer = tlsHandshakeTimers.get(socket);
		if (timer === undefined) return;
		clearTimeout(timer);
		tlsHandshakeTimers.delete(socket);
	};
	const clearAllTlsHandshakeTimers = (): void => {
		for (const timer of tlsHandshakeTimers.values()) clearTimeout(timer);
		tlsHandshakeTimers.clear();
	};
	const sockets = new Set<net.Socket>();
	const tlsParentSocket = (socket: net.Socket): net.Socket => {
		const parent = (socket as tls.TLSSocket & { _parent?: net.Socket })._parent;
		return parent ?? socket;
	};
	const trackSocket = (socket: net.Socket): void => {
		if (sockets.has(socket)) return;
		sockets.add(socket);
		socket.once("close", () => {
			sockets.delete(socket);
			const parent = tlsParentSocket(socket);
			pendingHandshakes.release(parent);
			clearTlsHandshakeTimer(parent);
		});
	};
	const destroyTlsPair = (socket: net.Socket): void => {
		const parent = tlsParentSocket(socket);
		clearTlsHandshakeTimer(parent);
		pendingHandshakes.release(parent);
		socket.destroy();
		if (parent !== socket) parent.destroy();
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
					const parent = tlsParentSocket(socket);
					clearTlsHandshakeTimer(parent);
					if (!pendingHandshakes.release(parent)) {
						destroyTlsPair(socket);
						return;
					}
					if (!limiter.allow(sourceAddress(parent))) {
						destroyTlsPair(socket);
						return;
					}
					trackSocket(socket);
					invokeConnection(socket);
				},
			);
			server = tlsServer;
			tlsServer.on("connection", socket => {
				if (!pendingHandshakes.acquire(socket)) {
					socket.destroy();
					return;
				}
				trackSocket(socket);
				const timer = setTimeout(() => {
					destroyTlsPair(socket);
				}, DEFAULT_TLS_HANDSHAKE_TIMEOUT_MS);
				tlsHandshakeTimers.set(socket, timer);
			});
			tlsServer.on("tlsClientError", (_error, socket) => destroyTlsPair(socket));
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
		pendingHandshakes.close();
		clearAllTlsHandshakeTimers();
		for (const socket of sockets) socket.destroy();
		if (server) await closeServer(server).catch(() => undefined);
		throw error;
	}
	if (!server) {
		limiter.close();
		pendingHandshakes.close();
		clearAllTlsHandshakeTimers();
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
			pendingHandshakes.close();
			clearAllTlsHandshakeTimers();
			for (const socket of sockets) socket.destroy();
			await closeServer(server);
		},
	};
}

/** Return discovery data suitable for clients; authentication tokens are deliberately absent. */
export function daemonNativeServerDiscovery(server: DaemonNativeRemoteServer): DaemonNativeRemoteServer["discovery"] {
	return server.discovery;
}
