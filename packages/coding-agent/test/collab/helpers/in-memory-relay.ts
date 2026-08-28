/**
 * In-memory collab transport shared by the collab test suites.
 *
 * `FakeWebSocket` + `InMemoryRelay` replace the real Bun.serve relay and
 * loopback WebSocket. They mirror the production relay's forwarding contract
 * exactly (4-byte peerId envelope routing, peer-joined/peer-left control
 * frames) but deliver every frame on a microtask with zero network or timer
 * latency. Real `CollabSocket` / `CollabHost` / `CollabGuestLink` run
 * unchanged on top, so sealing, enveloping, the hello→welcome handshake, and
 * permission enforcement are all exercised.
 *
 * Usage: `installInMemoryRelay()` in `beforeAll`/`beforeEach`,
 * `uninstallInMemoryRelay()` in the matching `afterAll`/`afterEach`.
 */
import { rewriteEnvelopePeer, unpackEnvelope } from "@oh-my-pi/pi-coding-agent/collab/protocol";

/** Active relay the fake transport routes through; set between install/uninstall. */
let activeRelay: InMemoryRelay | null = null;

/** Pristine constructor captured before any test swaps it. */
const RealWebSocket = globalThis.WebSocket;

export class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	binaryType = "blob";
	readyState: number = FakeWebSocket.CONNECTING;
	readonly role: "host" | "guest";
	peerId = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	readonly #relay: InMemoryRelay;

	constructor(url: string) {
		const relay = activeRelay;
		if (!relay) throw new Error("FakeWebSocket: no active in-memory relay");
		this.#relay = relay;
		this.role = new URL(url).searchParams.get("role") === "host" ? "host" : "guest";
		queueMicrotask(() => {
			if (this.readyState !== FakeWebSocket.CONNECTING) return;
			this.readyState = FakeWebSocket.OPEN;
			relay.connect(this);
			this.onopen?.();
		});
	}

	send(data: Uint8Array): void {
		if (this.readyState !== FakeWebSocket.OPEN) return;
		// Snapshot: the relay rewrites the peerId in place, and the sender may
		// reuse the buffer once send() returns.
		const bytes = new Uint8Array(data);
		queueMicrotask(() => this.#relay.forward(this, bytes));
	}

	close(_code?: number): void {
		if (this.readyState === FakeWebSocket.CLOSED) return;
		this.readyState = FakeWebSocket.CLOSED;
		this.#relay.disconnect(this);
		queueMicrotask(() => this.onclose?.({ code: 1000, reason: "closed" }));
	}

	/** Relay → this socket: a binary frame, delivered as ArrayBuffer (binaryType "arraybuffer"). */
	deliver(bytes: Uint8Array): void {
		if (this.readyState !== FakeWebSocket.OPEN) return;
		const copy = new Uint8Array(bytes);
		queueMicrotask(() => this.onmessage?.({ data: copy.buffer }));
	}

	/** Relay → this socket: a JSON control message. */
	deliverControl(json: string): void {
		if (this.readyState !== FakeWebSocket.OPEN) return;
		queueMicrotask(() => this.onmessage?.({ data: json }));
	}
}

/** Single-room in-memory relay mirroring the production forwarding contract. */
export class InMemoryRelay {
	#host: FakeWebSocket | null = null;
	readonly #guests = new Map<number, FakeWebSocket>();
	#nextPeerId = 1;
	onHostFrame?: (bytes: Uint8Array, targetPeer: number) => void;
	onGuestFrame?: (bytes: Uint8Array, peerId: number) => void;
	#paused = false;
	#pendingGuestDeliveries: (() => void)[] = [];
	#pauseAfterHostFrames: number | null = null;
	#hostFrameCount = 0;

	/** Hold host-to-guest frames; guest-to-host ACKs remain live. */
	pauseGuestTraffic(): void {
		this.#paused = true;
	}

	/** Resume held host-to-guest frames in original relay order. */
	resumeGuestTraffic(): void {
		this.#paused = false;
		const pending = this.#pendingGuestDeliveries.splice(0);
		for (const deliver of pending) deliver();
	}

	/** Pause immediately after forwarding the given host frame count. */
	pauseAfterHostFrames(count: number): void {
		if (!Number.isSafeInteger(count) || count < 1) throw new Error("invalid host frame pause count");
		this.#paused = false;
		this.#pauseAfterHostFrames = count;
		this.#hostFrameCount = 0;
	}

	dropGuest(peerId: number): void {
		this.#guests.get(peerId)?.close();
	}

	get pendingGuestDeliveryCount(): number {
		return this.#pendingGuestDeliveries.length;
	}

	#deliverGuest(guest: FakeWebSocket, bytes: Uint8Array): void {
		if (this.#paused) this.#pendingGuestDeliveries.push(() => guest.deliver(bytes));
		else guest.deliver(bytes);
	}

	connect(ws: FakeWebSocket): void {
		if (ws.role === "host") {
			this.#host = ws;
			return;
		}
		ws.peerId = this.#nextPeerId++;
		this.#guests.set(ws.peerId, ws);
		this.#host?.deliverControl(JSON.stringify({ t: "peer-joined", peer: ws.peerId }));
	}

	forward(from: FakeWebSocket, bytes: Uint8Array): void {
		if (from.role === "host") {
			const envelope = unpackEnvelope(bytes);
			if (!envelope) return;
			this.onHostFrame?.(new Uint8Array(bytes), envelope.peerId);
			const pauseNow = this.#pauseAfterHostFrames !== null && ++this.#hostFrameCount >= this.#pauseAfterHostFrames;
			if (pauseNow) this.#pauseAfterHostFrames = null;
			if (envelope.peerId === 0) {
				for (const guest of this.#guests.values()) this.#deliverGuest(guest, bytes);
			} else {
				const guest = this.#guests.get(envelope.peerId);
				if (guest) this.#deliverGuest(guest, bytes);
			}
			if (pauseNow) this.#paused = true;
			return;
		}
		rewriteEnvelopePeer(bytes, from.peerId);
		this.onGuestFrame?.(new Uint8Array(bytes), from.peerId);
		this.#host?.deliver(bytes);
	}

	disconnect(ws: FakeWebSocket): void {
		if (ws.role === "host") {
			if (this.#host === ws) this.#host = null;
			return;
		}
		this.#guests.delete(ws.peerId);
		this.#host?.deliverControl(JSON.stringify({ t: "peer-left", peer: ws.peerId }));
	}
}

/**
 * Create a fresh relay and route `new WebSocket(...)` through it.
 * Pair with {@link uninstallInMemoryRelay} in the matching after-hook.
 */
export function installInMemoryRelay(): InMemoryRelay {
	activeRelay = new InMemoryRelay();
	globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
	return activeRelay;
}

/**
 * Restore the real WebSocket constructor and drop the active relay. Sockets
 * already constructed keep their own relay reference, so in-flight teardown
 * (e.g. `host.stop()`) still works after uninstall.
 */
export function uninstallInMemoryRelay(): void {
	globalThis.WebSocket = RealWebSocket;
	activeRelay = null;
}
