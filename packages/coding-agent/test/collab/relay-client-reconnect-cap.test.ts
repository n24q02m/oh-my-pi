import { afterEach, describe, expect, it, vi } from "bun:test";
import { CollabSocket } from "../../src/collab/relay-client";

const ORIGINAL_WEBSOCKET = globalThis.WebSocket;
const RECONNECT_DELAYS_MS = [750, 1_500, 3_000, 6_000, 12_000];

class ReconnectWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: ReconnectWebSocket[] = [];

	readonly url: string;
	binaryType = "arraybuffer";
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onopen: ((event: Event) => void) | null = null;
	readyState = ReconnectWebSocket.CONNECTING;

	constructor(url: string) {
		this.url = url;
		ReconnectWebSocket.instances.push(this);
	}

	close(code = 1000, reason = "closed"): void {
		if (this.readyState === ReconnectWebSocket.CLOSED) return;
		this.readyState = ReconnectWebSocket.CLOSED;
		this.onclose?.({ code, reason } as CloseEvent);
	}

	drop(code: number, reason = ""): void {
		this.close(code, reason);
	}

	open(): void {
		this.readyState = ReconnectWebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}
}

function makeSocket(): CollabSocket {
	const socket = new CollabSocket({
		wsUrl: "ws://localhost:8788/r/reconnect-cap",
		role: "host",
		key: {} as CryptoKey,
	});
	globalThis.WebSocket = ReconnectWebSocket as unknown as typeof WebSocket;
	return socket;
}

function latestWebSocket(): ReconnectWebSocket {
	const ws = ReconnectWebSocket.instances.at(-1);
	if (!ws) throw new Error("CollabSocket did not construct a WebSocket");
	return ws;
}

describe("CollabSocket bounded reconnect", () => {
	afterEach(() => {
		globalThis.WebSocket = ORIGINAL_WEBSOCKET;
		ReconnectWebSocket.instances = [];
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("terminates after persistent transient failures without scheduling another retry", () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0);
		const socket = makeSocket();
		const closes: Array<[string, boolean]> = [];
		socket.onClose = (reason, willReconnect) => closes.push([reason, willReconnect]);

		socket.connect();
		for (const delay of RECONNECT_DELAYS_MS) {
			latestWebSocket().drop(1006, "temporary outage");
			expect(closes.at(-1)).toEqual(["temporary outage", true]);
			vi.runOnlyPendingTimers();
		}

		latestWebSocket().drop(1006, "temporary outage");
		expect(closes.at(-1)).toEqual(["temporary outage", false]);
		expect(ReconnectWebSocket.instances).toHaveLength(RECONNECT_DELAYS_MS.length + 1);
		vi.advanceTimersByTime(60_000);
		expect(ReconnectWebSocket.instances).toHaveLength(RECONNECT_DELAYS_MS.length + 1);
	});

	it("resets the reconnect budget after a successful open", () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0);
		const socket = makeSocket();
		const closes: Array<[string, boolean]> = [];
		socket.onClose = (reason, willReconnect) => closes.push([reason, willReconnect]);

		socket.connect();
		latestWebSocket().open();
		latestWebSocket().drop(1006, "temporary outage");
		vi.runOnlyPendingTimers();
		latestWebSocket().open();
		latestWebSocket().drop(1006, "temporary outage");
		vi.runOnlyPendingTimers();

		expect(closes).toEqual([
			["temporary outage", true],
			["temporary outage", true],
		]);
		expect(ReconnectWebSocket.instances).toHaveLength(3);
	});

	it("does not reconnect after an intentional close", () => {
		vi.useFakeTimers();
		const socket = makeSocket();
		const closes: Array<[string, boolean]> = [];
		socket.onClose = (reason, willReconnect) => closes.push([reason, willReconnect]);

		socket.connect();
		latestWebSocket().open();
		socket.close();
		vi.advanceTimersByTime(60_000);

		expect(closes).toEqual([["closed", false]]);
		expect(ReconnectWebSocket.instances).toHaveLength(1);
	});

	it("does not reconnect for fatal relay close codes", () => {
		vi.useFakeTimers();
		const fatalReasons = new Map([
			[4001, "room closed"],
			[4004, "no such room"],
			[4009, "a host is already connected for this room"],
			[4029, "room is full"],
		]);

		for (const [code, reason] of fatalReasons) {
			ReconnectWebSocket.instances = [];
			const socket = makeSocket();
			const closes: Array<[string, boolean]> = [];
			socket.onClose = (closeReason, willReconnect) => closes.push([closeReason, willReconnect]);
			socket.connect();
			latestWebSocket().drop(code);
			vi.advanceTimersByTime(60_000);
			expect(closes).toEqual([[reason, false]]);
			expect(ReconnectWebSocket.instances).toHaveLength(1);
		}
	});
});
