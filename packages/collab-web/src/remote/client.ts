import { createDeviceStore, type DeviceStore } from "./device-store";

export type RemoteCapability = "observe" | "control-session" | "approve" | "manage-devices" | "git-read";
export type RemotePhase = "unauthenticated" | "connecting" | "live" | "reconnecting" | "revoked" | "closed";

export interface RemoteSnapshot {
	name: string;
	id: string;
	state: string;
	pid?: number;
	createdAt: number;
	startedAt: number;
	readyAt?: number;
	exitedAt?: number;
	exitCode?: number;
	exitReason?: string;
	restartCount: number;
	outputBytes: number;
	owner?: string;
	persist: boolean;
	detached: boolean;
}

export interface RemoteSpec {
	name: string;
	application: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
	pty: boolean;
	restart: string;
	persist: boolean;
	detached: boolean;
}

export interface RemoteGitStatus {
	daemonName: string;
	repositoryRoot?: string;
	worktreePath: string;
	gitDir?: string;
	commonDir?: string;
	branch?: string;
	detached: boolean;
	head?: string;
	upstream?: string;
	dirty: boolean;
	ahead?: number;
	behind?: number;
	diffStat?: { files: number; insertions: number; deletions: number };
	refreshedAt: number;
	cached: boolean;
	error?: { code: string; message: string };
}

export interface RemoteApprovalRequest {
	id: string;
	daemonName: string;
	operation: string;
	summary: string;
	createdAt: number;
	expiresAt: number;
}

export type RemoteOperation =
	| { op: "ping" }
	| { op: "list" }
	| { op: "git-status"; name: string; refresh?: boolean }
	| {
			op: "logs";
			name: string;
			lines: number;
			head: boolean;
			follow: boolean;
			timeoutMs: number;
			cursor?: number;
			grep?: string;
	  }
	| { op: "wait"; name: string; for: "ready" | "exit"; timeoutMs: number; pattern?: string }
	| { op: "describe"; name: string }
	| { op: "start"; spec: RemoteSpec; owner?: string }
	| { op: "send"; name: string; data?: string; signal?: string }
	| { op: "stop"; name: string; timeoutMs: number }
	| { op: "restart"; name: string }
	| { op: "resume"; name: string; session?: string; timeoutMs?: number }
	| { op: "shutdown" }
	| { op: "pair-list" }
	| { op: "pair-revoke"; id: string }
	| { op: "pair-rotate"; id: string };

export type RemoteResult =
	| { op: "ping"; projectDir: string; capabilities?: RemoteCapability[] }
	| { op: "list"; daemons: RemoteSnapshot[] }
	| { op: "git-status"; status: RemoteGitStatus }
	| {
			op: "logs";
			name: string;
			text: string;
			terminalRows?: string[];
			cursor: number;
			timedOut: boolean;
			state: string;
	  }
	| { op: "wait"; daemon: RemoteSnapshot; matched?: string; timedOut: boolean }
	| { op: "describe"; daemon: RemoteSnapshot; spec: RemoteSpec }
	| { op: "start" | "send" | "stop" | "restart" | "resume"; daemon: RemoteSnapshot; readyTimedOut?: boolean }
	| {
			op: "pair-list";
			devices: Array<{
				id: string;
				name: string;
				capabilities: RemoteCapability[];
				createdAt: number;
				rotatedAt?: number;
				lastSeenAt?: number;
			}>;
	  }
	| { op: "pair-revoke"; id: string }
	| {
			op: "pair-rotate";
			device: { id: string; name: string; capabilities: RemoteCapability[]; createdAt: number };
			token: string;
	  }
	| { op: "shutdown" };

export interface RemoteClientSnapshot {
	phase: RemotePhase;
	error: string | null;
	projectDir: string | null;
	capabilities: readonly RemoteCapability[];
	daemons: readonly RemoteSnapshot[];
	approvals: readonly RemoteApprovalRequest[];
}

export interface RemoteSocket {
	readyState: number;
	onopen: (() => void) | null;
	onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null;
	onerror: (() => void) | null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null;
	send(data: string): void;
	close(code?: number, reason?: string): void;
}

export interface RemoteClientOptions {
	url?: string;
	deviceStore?: DeviceStore;
	webSocketFactory?: (url: string) => RemoteSocket;
	reconnectDelayMs?: number;
	maxReconnectAttempts?: number;
	requestTimeoutMs?: number;
}

interface PendingRequest {
	operation: RemoteOperation;
	resolve: (result: RemoteResult) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface RemoteMessage {
	type?: unknown;
	[key: string]: unknown;
}

function defaultSocketFactory(url: string): RemoteSocket {
	return new WebSocket(url) as unknown as RemoteSocket;
}

function websocketUrl(value: string | undefined): string {
	let base: URL;
	if (value === undefined) {
		if (typeof window === "undefined") throw new Error("Remote gateway URL is required outside a browser");
		base = new URL(window.location.href);
	} else base = new URL(value);
	if (base.username || base.password || base.search || base.hash)
		throw new Error("Remote gateway URL cannot contain credentials or query parameters");
	if (base.protocol === "http:") base.protocol = "ws:";
	else if (base.protocol === "https:") base.protocol = "wss:";
	else if (base.protocol !== "ws:" && base.protocol !== "wss:")
		throw new Error("Remote gateway URL must use http(s) or ws(s)");
	base.pathname = "/ws";
	return base.toString();
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseApprovalRequest(value: unknown): RemoteApprovalRequest | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.id !== "string" ||
		typeof value.daemonName !== "string" ||
		typeof value.operation !== "string" ||
		typeof value.summary !== "string" ||
		typeof value.createdAt !== "number" ||
		typeof value.expiresAt !== "number"
	) {
		return undefined;
	}
	return {
		id: value.id,
		daemonName: value.daemonName,
		operation: value.operation,
		summary: value.summary,
		createdAt: value.createdAt,
		expiresAt: value.expiresAt,
	};
}

function parseRemoteResult(value: unknown): RemoteResult {
	if (!isRecord(value) || typeof value.op !== "string") throw new Error("Remote result is malformed");
	const result = value as RemoteResult;
	return result;
}

function safeError(value: unknown, token: string | undefined): string {
	let message = value instanceof Error ? value.message : typeof value === "string" ? value : "Remote request failed";
	if (token) message = message.replaceAll(token, "[redacted]");
	message = message.replaceAll(/[\u0000-\u001f\u007f]+/gu, " ").trim();
	return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function decodeMessage(value: string | ArrayBuffer | Blob): Promise<string> {
	if (typeof value === "string") return Promise.resolve(value);
	if (value instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(value));
	if (typeof Blob !== "undefined" && value instanceof Blob) return value.text();
	return Promise.reject(new Error("Remote websocket message is not text"));
}

/** Browser-side authenticated supervisor connection with bounded reconnects. */
export class RemoteClient {
	readonly #store: DeviceStore;
	readonly #socketFactory: (url: string) => RemoteSocket;
	readonly #url: string | undefined;
	readonly #reconnectDelayMs: number;
	readonly #maxReconnectAttempts: number;
	readonly #requestTimeoutMs: number;
	readonly #listeners = new Set<() => void>();
	readonly #pending = new Map<string, PendingRequest>();
	#socket: RemoteSocket | undefined;
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	#closed = true;
	#manualClose = false;
	#attempt = 0;
	#reqSeq = 0;
	#authFailed = false;
	#snapshot: RemoteClientSnapshot = {
		phase: "unauthenticated",
		error: null,
		projectDir: null,
		capabilities: [],
		daemons: [],
		approvals: [],
	};

	constructor(options: RemoteClientOptions = {}) {
		this.#store = options.deviceStore ?? createDeviceStore();
		this.#socketFactory = options.webSocketFactory ?? defaultSocketFactory;
		this.#url = options.url;
		this.#reconnectDelayMs =
			options.reconnectDelayMs !== undefined && options.reconnectDelayMs > 0 ? options.reconnectDelayMs : 500;
		this.#maxReconnectAttempts =
			options.maxReconnectAttempts !== undefined && options.maxReconnectAttempts > 0
				? Math.floor(options.maxReconnectAttempts)
				: 5;
		this.#requestTimeoutMs =
			options.requestTimeoutMs !== undefined && options.requestTimeoutMs > 0 ? options.requestTimeoutMs : 30_000;
	}

	getSnapshot(): RemoteClientSnapshot {
		return this.#snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	connect(): void {
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		this.#manualClose = false;
		this.#closed = false;
		this.#attempt = 0;
		this.#authFailed = false;
		if (this.#socket) return;
		if (!this.#store.read()) {
			this.#setSnapshot({ phase: "unauthenticated", error: "Enter a paired device token" });
			return;
		}
		this.#open();
	}

	close(): void {
		this.#manualClose = true;
		this.#closed = true;
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		this.#socket?.close(1000, "client closed");
		this.#socket = undefined;
		this.#rejectPending(new Error("Remote client closed"));
		this.#setSnapshot({ phase: "closed", error: null, approvals: [] });
	}

	logout(): void {
		this.close();
		this.#store.clear();
		this.#setSnapshot({
			phase: "unauthenticated",
			error: null,
			projectDir: null,
			capabilities: [],
			daemons: [],
			approvals: [],
		});
	}

	async request(operation: RemoteOperation): Promise<RemoteResult> {
		const socket = this.#socket;
		if (!socket || this.#snapshot.phase !== "live") throw new Error("Remote client is not connected");
		const id = `remote-${++this.#reqSeq}`;
		const result = new Promise<RemoteResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`Remote ${operation.op} request timed out`));
			}, this.#requestTimeoutMs);
			this.#pending.set(id, { operation, resolve, reject, timer });
		});
		try {
			socket.send(JSON.stringify({ type: "request", id, operation }));
		} catch (error) {
			const pending = this.#pending.get(id);
			if (pending) {
				clearTimeout(pending.timer);
				this.#pending.delete(id);
				pending.reject(new Error(safeError(error, this.#store.read())));
			}
		}
		return result;
	}

	approve(requestId: string, decision: "approve" | "deny"): void {
		if (!this.#socket || this.#snapshot.phase !== "live") throw new Error("Remote client is not connected");
		if (!requestId || requestId.length > 128) throw new Error("Remote approval id is invalid");
		this.#socket.send(JSON.stringify({ type: "approval", requestId, decision }));
	}

	hasCapability(capability: RemoteCapability): boolean {
		return this.#snapshot.capabilities.includes(capability);
	}

	#open(): void {
		if (this.#socket || this.#closed) return;
		let url: string;
		try {
			url = websocketUrl(this.#url);
		} catch (error) {
			this.#setSnapshot({ phase: "unauthenticated", error: safeError(error, this.#store.read()) });
			return;
		}
		this.#setSnapshot({ phase: this.#attempt > 0 ? "reconnecting" : "connecting", error: null });
		let socket: RemoteSocket;
		try {
			socket = this.#socketFactory(url);
		} catch (error) {
			this.#handleSocketFailure(safeError(error, this.#store.read()));
			return;
		}
		this.#socket = socket;
		socket.onopen = () => {
			if (this.#socket !== socket) return;
			const token = this.#store.read();
			if (!token) {
				this.logout();
				return;
			}
			this.#authFailed = false;
			socket.send(JSON.stringify({ type: "auth", token }));
		};
		socket.onmessage = event => {
			if (this.#socket !== socket) return;
			void decodeMessage(event.data)
				.then(text => {
					if (this.#socket === socket) this.#handleMessage(text);
				})
				.catch(error => {
					if (this.#socket === socket) this.#setSnapshot({ error: safeError(error, this.#store.read()) });
				});
		};
		socket.onerror = () => {};
		socket.onclose = event => {
			if (this.#socket === socket) this.#handleClose(event.code ?? 1006, event.reason ?? "connection closed");
		};
	}

	#handleMessage(text: string): void {
		let message: RemoteMessage;
		try {
			const decoded: unknown = JSON.parse(text);
			if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
				throw new Error("Remote message must be an object");
			message = decoded as RemoteMessage;
		} catch (error) {
			this.#setSnapshot({ error: safeError(error, this.#store.read()) });
			return;
		}
		if (message.type === "authenticated") {
			const capabilities = Array.isArray(message.capabilities)
				? message.capabilities.filter(
						(value): value is RemoteCapability =>
							value === "observe" ||
							value === "control-session" ||
							value === "approve" ||
							value === "manage-devices" ||
							value === "git-read",
					)
				: [];
			this.#attempt = 0;
			this.#setSnapshot({
				phase: "live",
				error: null,
				projectDir: typeof message.projectDir === "string" ? message.projectDir : null,
				capabilities,
				approvals: [],
			});
			void this.request({ op: "list" }).catch(error =>
				this.#setSnapshot({ error: safeError(error, this.#store.read()) }),
			);
			return;
		}
		if (message.type === "approval-required") {
			const request = parseApprovalRequest(message.request);
			const pending = typeof message.id === "string" ? this.#pending.get(message.id) : undefined;
			if (request && pending && typeof message.id === "string") {
				const responseId = message.id;
				clearTimeout(pending.timer);
				pending.timer = setTimeout(
					() => {
						this.#pending.delete(responseId);
						this.#setSnapshot({ approvals: this.#snapshot.approvals.filter(item => item.id !== request.id) });
						pending.reject(new Error("Remote approval expired"));
					},
					Math.max(0, request.expiresAt - Date.now()),
				);
				this.#setSnapshot({
					approvals: [...this.#snapshot.approvals.filter(item => item.id !== request.id), request],
				});
			}
			return;
		}
		if (
			(message.type === "approval-resolved" || message.type === "approval-expired") &&
			typeof message.requestId === "string"
		) {
			this.#setSnapshot({ approvals: this.#snapshot.approvals.filter(request => request.id !== message.requestId) });
			return;
		}
		if (message.type === "response" && typeof message.id === "string") {
			const pending = this.#pending.get(message.id);
			if (!pending) return;
			this.#pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.ok === true) {
				try {
					const result = parseRemoteResult(message.result);
					this.#applyResult(result);
					pending.resolve(result);
				} catch (error) {
					pending.reject(new Error(safeError(error, this.#store.read())));
				}
			} else pending.reject(new Error(safeError(message.error, this.#store.read())));
			return;
		}
		if (message.type === "error") {
			if (message.code === "authentication-failed") {
				this.#authFailed = true;
				this.#store.clear();
			}
			const pending = typeof message.id === "string" ? this.#pending.get(message.id) : undefined;
			if (pending && typeof message.id === "string") {
				this.#pending.delete(message.id);
				clearTimeout(pending.timer);
				pending.reject(new Error(safeError(message.message, this.#store.read())));
			} else this.#setSnapshot({ error: safeError(message.message, this.#store.read()) });
		}
	}

	#applyResult(result: RemoteResult): void {
		if (result.op === "list") {
			this.#setSnapshot({ daemons: result.daemons.map(daemon => ({ ...daemon })) });
			return;
		}
		if ("daemon" in result) {
			const daemon = result.daemon;
			const daemons = this.#snapshot.daemons.some(item => item.name === daemon.name)
				? this.#snapshot.daemons.map(item => (item.name === daemon.name ? { ...daemon } : item))
				: [...this.#snapshot.daemons, { ...daemon }];
			this.#setSnapshot({ daemons });
		}
	}

	#handleClose(code: number, reason: string): void {
		this.#socket = undefined;
		this.#rejectPending(new Error("Remote connection closed"));
		if (this.#manualClose || this.#closed) {
			this.#setSnapshot({ phase: "closed", error: null, approvals: [] });
			return;
		}
		if (this.#authFailed || code === 4003) {
			this.#store.clear();
			this.#setSnapshot({
				phase: "revoked",
				error: "Device token was rejected",
				projectDir: null,
				capabilities: [],
				daemons: [],
				approvals: [],
			});
			return;
		}
		if (!this.#store.read() || this.#attempt >= this.#maxReconnectAttempts) {
			this.#setSnapshot({ phase: "closed", error: safeError(reason, this.#store.read()), approvals: [] });
			return;
		}
		this.#attempt += 1;
		this.#setSnapshot({ phase: "reconnecting", error: safeError(reason, this.#store.read()), approvals: [] });
		const delay = Math.min(this.#reconnectDelayMs * 2 ** (this.#attempt - 1), 10_000);
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = undefined;
			if (!this.#closed) this.#open();
		}, delay);
	}

	#handleSocketFailure(message: string): void {
		this.#socket = undefined;
		if (this.#attempt >= this.#maxReconnectAttempts) {
			this.#setSnapshot({ phase: "closed", error: message, approvals: [] });
			return;
		}
		this.#attempt += 1;
		this.#setSnapshot({ phase: "reconnecting", error: message });
		this.#reconnectTimer = setTimeout(
			() => {
				this.#reconnectTimer = undefined;
				if (!this.#closed) this.#open();
			},
			Math.min(this.#reconnectDelayMs * 2 ** (this.#attempt - 1), 10_000),
		);
	}

	#rejectPending(error: Error): void {
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.#pending.clear();
	}

	#setSnapshot(changes: Partial<RemoteClientSnapshot>): void {
		this.#snapshot = {
			...this.#snapshot,
			...changes,
			capabilities: changes.capabilities ? [...changes.capabilities] : this.#snapshot.capabilities,
			daemons: changes.daemons ? changes.daemons.map(daemon => ({ ...daemon })) : this.#snapshot.daemons,
			approvals: changes.approvals ? changes.approvals.map(request => ({ ...request })) : this.#snapshot.approvals,
		};
		for (const listener of this.#listeners) listener();
	}
}
