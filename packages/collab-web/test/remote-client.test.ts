import { describe, expect, it } from "bun:test";
import { RemoteClient, type RemoteSocket } from "../src/remote/client";
import { DeviceStore, REMOTE_DEVICE_TOKEN_KEY, type StorageLike } from "../src/remote/device-store";

class MemoryStorage implements StorageLike {
	readonly values = new Map<string, string>();
	getItem(key: string): string | null { return this.values.get(key) ?? null; }
	setItem(key: string, value: string): void { this.values.set(key, value); }
	removeItem(key: string): void { this.values.delete(key); }
}

class FakeSocket implements RemoteSocket {
	readyState = 1;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
	readonly sent: string[] = [];
	send(data: string): void { this.sent.push(data); }
	close(code?: number, reason?: string): void { this.readyState = 3; this.onclose?.({ code, reason }); }
}

describe("remote browser client", () => {
	it("sends the token only in the first websocket frame, never in the URL", () => {
		const storage = new MemoryStorage();
		const token = "a".repeat(64);
		new DeviceStore(storage).write(token);
		let socket: FakeSocket | undefined;
		const client = new RemoteClient({
			url: "https://operator.example/supervisor",
			deviceStore: new DeviceStore(storage),
			webSocketFactory: url => {
				expect(url).toBe("wss://operator.example/ws");
				socket = new FakeSocket();
				return socket;
			},
		});
		client.connect();
		socket?.onopen?.();
		expect(socket?.sent).toEqual([JSON.stringify({ type: "auth", token })]);
		expect(socket?.sent[0]).not.toContain("operator.example/ws?token");
		client.close();
	});

	it("clears revoked credentials after an authentication failure", async () => {
		const storage = new MemoryStorage();
		new DeviceStore(storage).write("b".repeat(64));
		let socket: FakeSocket | undefined;
		const client = new RemoteClient({
			url: "http://127.0.0.1:8787",
			deviceStore: new DeviceStore(storage),
			webSocketFactory: () => {
				socket = new FakeSocket();
				return socket;
			},
		});
		client.connect();
		socket?.onopen?.();
		socket?.onmessage?.({ data: JSON.stringify({ type: "error", code: "authentication-failed", message: "bad token" }) });
		socket?.onclose?.({ code: 4003, reason: "authentication failed" });
		await Promise.resolve();
		expect(storage.getItem(REMOTE_DEVICE_TOKEN_KEY)).toBeNull();
		expect(client.getSnapshot().phase).toBe("revoked");
	});
});
