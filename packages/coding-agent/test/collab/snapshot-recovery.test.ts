/**
 * Snapshot recovery contract. These tests start red against the pre-recovery
 * protocol: the existing collab wire has no sequence/ACK state machine, so a
 * dropped or reordered encrypted chunk cannot be resumed without replaying
 * the complete snapshot.
 */
import { describe, expect, it } from "bun:test";
import { importRoomKey, open, seal } from "@oh-my-pi/pi-coding-agent/collab/crypto";
import * as protocol from "@oh-my-pi/pi-coding-agent/collab/protocol";

const encoder = new TextEncoder();

function payloads(count: number): Uint8Array[] {
	return Array.from({ length: count }, (_, index) => encoder.encode(`entry-${index}`));
}

describe("collab snapshot recovery", () => {
	it("assigns stable sequence numbers and bounds the encrypted send window", () => {
		const sender = new protocol.SnapshotSender("snapshot-a", payloads(12));
		const initial = sender.nextWindow();

		expect(initial.map(chunk => chunk.seq)).toEqual([0, 1, 2, 3]);
		expect(initial.every(chunk => chunk.snapshotId === "snapshot-a")).toBe(true);
		expect(sender.inFlightCount).toBe(protocol.SNAPSHOT_SEND_WINDOW);
	});

	it("recovers from dropped, duplicated, reordered, and delayed chunks without replay", () => {
		const source = payloads(8);
		const sender = new protocol.SnapshotSender("snapshot-b", source);
		const receiver = new protocol.SnapshotReceiver();
		receiver.begin({ t: "snapshot-begin", snapshotId: "snapshot-b", total: 8 });

		const initial = sender.nextWindow();
		receiver.accept(initial[2]!);
		receiver.accept(initial[2]!);
		receiver.accept(initial[1]!);
		expect(receiver.contiguousSeq).toBe(-1);
		expect(receiver.ack().missing).toEqual([0]);

		const retry = sender.acknowledge(receiver.ack());
		expect(retry.chunks.map(chunk => chunk.seq)).toContain(0);
		receiver.accept(retry.chunks.find(chunk => chunk.seq === 0)!);
		receiver.accept(initial[0]!);
		expect(receiver.contiguousSeq).toBe(2);

		for (let round = 0; round < 12 && receiver.contiguousSeq < source.length - 1; round++) {
			for (const chunk of sender.acknowledge(receiver.ack()).chunks) receiver.accept(chunk);
		}
		expect(receiver.contiguousSeq).toBe(7);
		expect(receiver.assemble()).toEqual(Buffer.concat(source.map(bytes => Buffer.from(bytes))));
	});

	it("rejects corrupted payloads while keeping the missing sequence in the ACK", () => {
		const sender = new protocol.SnapshotSender("snapshot-c", payloads(2));
		const receiver = new protocol.SnapshotReceiver();
		receiver.begin({ t: "snapshot-begin", snapshotId: "snapshot-c", total: 2 });
		const chunk = sender.nextWindow()[0]!;
		const corrupted = { ...chunk, payload: protocol.encodeSnapshotPayload(encoder.encode("tampered")) };

		const result = receiver.accept(corrupted);
		expect(result.corrupt).toBe(true);
		expect(result.ack.contiguousSeq).toBe(-1);
		expect(result.ack.missing).toEqual([0]);
	});

	it("ignores stale ACKs, replaces incompatible snapshots, and bounds retries", () => {
		const sender = new protocol.SnapshotSender("snapshot-d", payloads(1));
		const initial = sender.nextWindow();
		expect(sender.acknowledge({ t: "snapshot-ack", snapshotId: "old", contiguousSeq: 0 }).chunks).toEqual([]);
		expect(
			sender.acknowledge({ t: "snapshot-ack", snapshotId: "snapshot-d", contiguousSeq: -1 }).chunks,
		).toHaveLength(0);
		for (let attempt = 0; attempt < protocol.SNAPSHOT_MAX_RETRIES; attempt++) {
			const retry = sender.onTimeout();
			if (attempt < protocol.SNAPSHOT_MAX_RETRIES - 1) expect(retry.exhausted).toBe(false);
		}
		expect(sender.onTimeout().exhausted).toBe(true);

		const receiver = new protocol.SnapshotReceiver();
		receiver.begin({ t: "snapshot-begin", snapshotId: "snapshot-d", total: 1 });
		receiver.accept(initial[0]!);
		const replacement = receiver.begin({ t: "snapshot-begin", snapshotId: "snapshot-e", total: 1 });
		expect(replacement).toBe("replaced");
		expect(receiver.snapshotId).toBe("snapshot-e");
	});

	it("keeps snapshot control frames end-to-end encrypted", async () => {
		const key = await importRoomKey(new Uint8Array(32));
		const frame: protocol.SnapshotBeginFrame = {
			t: "snapshot-begin",
			snapshotId: "opaque-id",
			total: 1,
			firstHistoryCursor: "opaque-cursor",
		};
		const sealed = await seal(key, frame);
		const encoded = Buffer.from(sealed).toString("base64url");
		expect(encoded).not.toContain("snapshot-begin");
		expect(await open(key, sealed)).toEqual(frame);
	});
});
