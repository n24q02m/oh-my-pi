import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createDaemonBrokerClient, type DaemonBrokerClient } from "./client";
import { type DaemonCapability, type DaemonOperation, parseDaemonWireRequest } from "./protocol";
import { RemoteApprovalRegistry, type RemoteApprovalRequest } from "./remote-approval";
import { assertNativePathSafe } from "./remote-transport";

const MAX_FRAME_BYTES = 512 * 1024;
const MAX_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 512;
const AUTH_TIMEOUT_MS = 10_000;
const TLS_FILE_LIMIT_BYTES = 4 * 1024 * 1024;
const DEFAULT_PORT = 0;
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'";

const APPROVAL_REQUIRED_OPERATIONS = new Set<DaemonOperation["op"]>([
	"stop",
	"shutdown",
	"pair-deny",
	"pair-revoke",
	"pair-rotate",
]);

export interface WebGatewayOptions {
	projectDir: string;
	hostname?: string;
	port?: number;
	originAllowlist?: readonly string[];
	certFile?: string;
	keyFile?: string;
	staticDir?: string;
	authTimeoutMs?: number;
	maxFrameBytes?: number;
}

export interface WebGateway {
	readonly url: string;
	readonly websocketUrl: string;
	readonly originAllowlist: readonly string[];
	close(): Promise<void>;
}

type RemoteSocket = Bun.ServerWebSocket<SocketData>;

interface PendingRemoteApproval {
	request: RemoteApprovalRequest;
	operation: DaemonOperation;
	responseId: string;
	timer: NodeJS.Timeout;
}

interface SocketData {
	projectDir: string;
	client?: DaemonBrokerClient;
	authenticated: boolean;
	authenticating: boolean;
	closed: boolean;
	inFlight: number;
	capabilities: DaemonCapability[];
	pending: Map<string, PendingRemoteApproval>;
	approvals: RemoteApprovalRegistry;
	authTimer?: NodeJS.Timeout;
}

interface RemoteAuthMessage {
	type: "auth";
	token: string;
}

interface RemoteRequestMessage {
	type: "request";
	id: string;
	operation: DaemonOperation;
}

interface RemoteApprovalMessage {
	type: "approval";
	requestId: string;
	decision: "approve" | "deny";
}

interface RemoteMessage {
	type: string;
	[key: string]: unknown;
}

function boundedPositive(value: number | undefined, fallback: number, maximum: number): number {
	if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback;
	return Math.min(value, maximum);
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "127.0.0.1" || hostname === "::1" || hostname.toLowerCase() === "localhost";
}

function normalizeOrigin(value: string): string {
	const parsed = new URL(value);
	if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
		throw new Error("web gateway origins must contain only scheme, host, and port");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
		throw new Error("web gateway origins must use http or https");
	return parsed.origin;
}

function parseIncomingMessage(value: string | Buffer, maxBytes: number): RemoteMessage {
	const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
	if (bytes > maxBytes) throw new Error("websocket frame exceeds the configured limit");
	const text = typeof value === "string" ? value : new TextDecoder().decode(value);
	const decoded: unknown = JSON.parse(text);
	if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
		throw new Error("websocket message must be an object");
	const message = decoded as RemoteMessage;
	if (typeof message.type !== "string" || message.type.length > 32)
		throw new Error("websocket message type is invalid");
	return message;
}

function parseAuthMessage(message: RemoteMessage): RemoteAuthMessage {
	if (
		message.type !== "auth" ||
		typeof message.token !== "string" ||
		message.token.length === 0 ||
		message.token.length > MAX_TOKEN_LENGTH
	) {
		throw new Error("websocket authentication is required");
	}
	return { type: "auth", token: message.token };
}

function parseRequestMessage(message: RemoteMessage): RemoteRequestMessage {
	if (
		message.type !== "request" ||
		typeof message.id !== "string" ||
		message.id.length === 0 ||
		message.id.length > MAX_ID_LENGTH
	) {
		throw new Error("websocket request envelope is invalid");
	}
	const parsed = parseDaemonWireRequest({ id: message.id, token: "web-gateway", operation: message.operation });
	return { type: "request", id: parsed.id, operation: parsed.operation };
}

function parseApprovalMessage(message: RemoteMessage): RemoteApprovalMessage {
	if (
		message.type !== "approval" ||
		typeof message.requestId !== "string" ||
		message.requestId.length === 0 ||
		(message.decision !== "approve" && message.decision !== "deny")
	) {
		throw new Error("websocket approval envelope is invalid");
	}
	return { type: "approval", requestId: message.requestId, decision: message.decision };
}

function send(ws: RemoteSocket, message: Record<string, unknown>): void {
	ws.send(JSON.stringify(message));
}

function sendError(ws: RemoteSocket, id: string | undefined, message: string, code = "request-failed"): void {
	const body: Record<string, unknown> = { type: "error", code, message };
	if (id !== undefined) body.id = id;
	send(ws, body);
}

function isApprovalRequired(operation: DaemonOperation): boolean {
	return APPROVAL_REQUIRED_OPERATIONS.has(operation.op);
}
function hostAuthority(hostname: string): string {
	return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}

function defaultStaticDir(): string {
	const configured = process.env.OMP_COLLAB_WEB_DIST;
	if (configured) return path.resolve(configured);
	return path.resolve(import.meta.dir, "../../../collab-web/dist");
}

async function readTlsFile(filePath: string, label: string, privateFile: boolean): Promise<Buffer> {
	await assertNativePathSafe(filePath, { privateFinal: privateFile, privateParent: true });
	const stat = await fs.stat(filePath);
	if (!stat.isFile()) throw new Error(`web gateway TLS ${label} must be a regular file`);
	if (stat.size > TLS_FILE_LIMIT_BYTES) throw new Error(`web gateway TLS ${label} exceeds the 4 MiB limit`);
	const bytes = await fs.readFile(filePath);
	if (bytes.byteLength > TLS_FILE_LIMIT_BYTES) throw new Error(`web gateway TLS ${label} exceeds the 4 MiB limit`);
	await assertNativePathSafe(filePath, { privateFinal: privateFile, privateParent: true });
	return bytes;
}

function safeStaticPath(root: string, pathname: string): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}
	const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/u, "");
	const candidate = path.resolve(root, relative);
	const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
	if (candidate !== root && !candidate.startsWith(prefix)) return undefined;
	return candidate;
}

function contentType(filePath: string): string {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === ".html") return "text/html; charset=utf-8";
	if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
	if (extension === ".css") return "text/css; charset=utf-8";
	if (extension === ".json" || extension === ".webmanifest") return "application/json; charset=utf-8";
	if (extension === ".svg") return "image/svg+xml";
	if (extension === ".png") return "image/png";
	if (extension === ".ico") return "image/x-icon";
	return "application/octet-stream";
}

function staticHeaders(filePath: string): Headers {
	const headers = new Headers({
		"Content-Type": contentType(filePath),
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": CSP,
		"Referrer-Policy": "no-referrer",
		"Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
	});
	return headers;
}

async function serveStatic(request: Request, root: string): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response("Method not allowed", { status: 405 });
	const url = new URL(request.url);
	const candidate = safeStaticPath(root, url.pathname);
	if (!candidate) return new Response("Bad path", { status: 400 });
	let filePath = candidate;
	if (
		url.pathname === "/collab" ||
		url.pathname === "/collab/" ||
		url.pathname === "/remote" ||
		url.pathname === "/remote/"
	) {
		filePath = path.join(root, "index.html");
	}
	const file = Bun.file(filePath);
	if (!(await file.exists())) return new Response("Not found", { status: 404 });
	return new Response(request.method === "HEAD" ? null : file, { headers: staticHeaders(filePath) });
}

async function authenticateSocket(ws: RemoteSocket, message: RemoteMessage): Promise<void> {
	const auth = parseAuthMessage(message);
	const data = ws.data;
	if (data.authenticating || data.closed) throw new Error("websocket authentication is already pending or closed");
	data.authenticating = true;
	let client: DaemonBrokerClient | undefined;
	try {
		client = await createDaemonBrokerClient(data.projectDir, { token: auth.token });
		const ping = await client.request({ op: "ping" });
		if (ping.op !== "ping") throw new Error("web gateway broker handshake failed");
		if (data.closed) {
			client.close();
			return;
		}
		data.client = client;
		data.capabilities = [...(ping.capabilities ?? [])];
		data.authenticated = true;
		clearTimeout(data.authTimer);
		send(ws, {
			type: "authenticated",
			projectDir: ping.projectDir,
			capabilities: data.capabilities,
		});
	} catch (error) {
		client?.close();
		throw error;
	} finally {
		data.authenticating = false;
	}
}

async function executeRequest(ws: RemoteSocket, request: RemoteRequestMessage): Promise<void> {
	const data = ws.data;
	if (!data.client || !data.authenticated) throw new Error("websocket is not authenticated");
	if (isApprovalRequired(request.operation)) {
		const approval = data.approvals.create({
			daemonName: "name" in request.operation ? request.operation.name : "broker",
			operation: request.operation.op,
			summary: `Confirm remote ${request.operation.op} request`,
		});
		const timer = setTimeout(
			() => {
				if (!data.pending.delete(approval.id)) return;
				data.approvals.get(approval.id);
				if (!data.closed) {
					send(ws, { type: "response", id: request.id, ok: false, error: "remote request expired" });
					send(ws, { type: "approval-expired", requestId: approval.id });
				}
			},
			Math.max(0, approval.expiresAt - Date.now()),
		);
		timer.unref?.();
		data.pending.set(approval.id, { request: approval, operation: request.operation, responseId: request.id, timer });
		send(ws, { type: "approval-required", id: request.id, request: approval });
		return;
	}
	const result = await data.client.request(request.operation);
	send(ws, { type: "response", id: request.id, ok: true, result });
}

async function resolveApproval(ws: RemoteSocket, message: RemoteApprovalMessage): Promise<void> {
	const data = ws.data;
	if (!data.capabilities.includes("approve"))
		throw new Error("Daemon capability approve is required for approval actions");
	const pending = data.pending.get(message.requestId);
	if (!pending) throw new Error("Remote approval request is missing or expired");
	const resolution = data.approvals.resolve(message.requestId, message.decision);
	data.pending.delete(message.requestId);
	clearTimeout(pending.timer);
	if (resolution.decision === "deny") {
		send(ws, { type: "response", id: pending.responseId, ok: false, error: "remote request denied" });
		send(ws, { type: "approval-resolved", requestId: message.requestId, decision: "deny" });
		return;
	}
	if (!data.client) throw new Error("websocket broker client is unavailable");
	const result = await data.client.request(pending.operation);
	send(ws, { type: "response", id: pending.responseId, ok: true, result });
	send(ws, { type: "approval-resolved", requestId: message.requestId, decision: "approve" });
}

/** Start the browser supervisor gateway. Native broker authentication remains on the local socket. */
export async function startWebGateway(options: WebGatewayOptions): Promise<WebGateway> {
	const hostname = options.hostname ?? "127.0.0.1";
	const port = options.port ?? DEFAULT_PORT;
	if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("web gateway port must be 0-65535");
	const hasCert = options.certFile !== undefined;
	const hasKey = options.keyFile !== undefined;
	if (hasCert !== hasKey) throw new Error("web gateway TLS requires both certFile and keyFile");
	if (!isLoopbackHost(hostname) && !hasCert)
		throw new Error("non-loopback web gateway hosts require TLS certificate and key");
	const tls =
		hasCert && hasKey
			? {
					cert: await readTlsFile(options.certFile!, "certificate", false),
					key: await readTlsFile(options.keyFile!, "private key", true),
				}
			: undefined;
	const projectDir = path.resolve(options.projectDir);
	const staticDir = path.resolve(options.staticDir ?? defaultStaticDir());
	const maxFrameBytes = boundedPositive(options.maxFrameBytes, MAX_FRAME_BYTES, 4 * 1024 * 1024);
	const authTimeoutMs = boundedPositive(options.authTimeoutMs, AUTH_TIMEOUT_MS, 120_000);
	const sockets = new Set<RemoteSocket>();
	let server: Bun.Server<SocketData>;
	const configuredOrigins = options.originAllowlist?.map(normalizeOrigin) ?? [];

	server = Bun.serve<SocketData>({
		hostname,
		port,
		tls,
		fetch: async (request, instance): Promise<Response | undefined> => {
			const url = new URL(request.url);
			if (url.pathname === "/ws") {
				if (url.search || url.hash)
					return new Response("Websocket query parameters are not accepted", { status: 400 });
				const origin = request.headers.get("origin");
				const actualOrigin = `${tls ? "https" : "http"}://${hostAuthority(hostname)}:${server.port}`;
				const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : [actualOrigin];
				if (!origin || !allowedOrigins.includes(origin)) return new Response("Forbidden", { status: 403 });
				if (request.headers.has("cookie") || request.headers.has("sec-websocket-protocol")) {
					return new Response("Websocket credentials must be sent in the first encrypted frame", { status: 400 });
				}
				if (sockets.size >= 64) return new Response("Too many connections", { status: 503 });
				const data: SocketData = {
					projectDir,
					authenticated: false,
					authenticating: false,
					closed: false,
					inFlight: 0,
					capabilities: [],
					pending: new Map(),
					approvals: new RemoteApprovalRegistry(),
				};
				if (instance.upgrade(request, { data })) return undefined;
				return new Response("websocket upgrade required", { status: 426 });
			}
			return serveStatic(request, staticDir);
		},
		websocket: {
			maxPayloadLength: maxFrameBytes,
			idleTimeout: 0,
			open(ws: RemoteSocket): void {
				sockets.add(ws);
				ws.data.authTimer = setTimeout(() => ws.close(4001, "authentication timeout"), authTimeoutMs);
				ws.data.authTimer.unref?.();
			},
			message(ws: RemoteSocket, value: string | Buffer): void {
				if (ws.data.closed) return;
				if (ws.data.inFlight >= 32) {
					ws.close(1008, "too many pending requests");
					return;
				}
				ws.data.inFlight++;
				void (async () => {
					let message: RemoteMessage;
					try {
						message = parseIncomingMessage(value, maxFrameBytes);
					} catch (error) {
						sendError(
							ws,
							undefined,
							error instanceof Error ? error.message : "invalid websocket message",
							"invalid-message",
						);
						ws.close(1003, "invalid message");
						return;
					}
					try {
						if (!ws.data.authenticated) {
							await authenticateSocket(ws, message);
							return;
						}
						if (message.type === "request") await executeRequest(ws, parseRequestMessage(message));
						else if (message.type === "approval") await resolveApproval(ws, parseApprovalMessage(message));
						else throw new Error("unsupported websocket message");
					} catch (error) {
						const authenticationFailed =
							!ws.data.authenticated ||
							(error instanceof Error && error.message === "Daemon broker authentication failed");
						sendError(
							ws,
							typeof message.id === "string" ? message.id : undefined,
							error instanceof Error ? error.message : "request failed",
							authenticationFailed ? "authentication-failed" : "request-failed",
						);
						if (authenticationFailed) ws.close(4003, "authentication failed");
					}
				})()
					.finally(() => {
						ws.data.inFlight--;
					})
					.catch(() => ws.close(1011, "gateway request failed"));
			},
			close(ws: RemoteSocket): void {
				sockets.delete(ws);
				ws.data.closed = true;
				clearTimeout(ws.data.authTimer);
				for (const pending of ws.data.pending.values()) clearTimeout(pending.timer);
				ws.data.pending.clear();
				ws.data.approvals.clear();
				ws.data.client?.close();
			},
		},
	});

	const scheme = tls ? "https" : "http";
	const url = `${scheme}://${hostAuthority(hostname)}:${server.port}`;
	const websocketUrl = `${tls ? "wss" : "ws"}://${hostAuthority(hostname)}:${server.port}/ws`;
	const originAllowlist = configuredOrigins.length > 0 ? [...configuredOrigins] : [url];
	return {
		url,
		websocketUrl,
		originAllowlist,
		async close(): Promise<void> {
			for (const ws of sockets) ws.close(1001, "gateway closed");
			server.stop(true);
		},
	};
}
