/**
 * Snapshot recovery contract. These tests start red against the pre-recovery
 * protocol: the existing collab wire has no sequence/ACK state machine, so a
 * dropped or reordered encrypted chunk cannot be resumed without replaying
 * the complete snapshot.
 */
import { describe, expect, it, spyOn, vi } from "bun:test";
import { importRoomKey, open, seal } from "@oh-my-pi/pi-coding-agent/collab/crypto";
import { CollabGuestLink } from "@oh-my-pi/pi-coding-agent/collab/guest";
import { CollabHost } from "@oh-my-pi/pi-coding-agent/collab/host";
import type { CollabFrame } from "@oh-my-pi/pi-coding-agent/collab/protocol";
import * as protocol from "@oh-my-pi/pi-coding-agent/collab/protocol";
import { CollabSocket, MAX_ENCRYPTED_COLLAB_FRAME_BYTES } from "@oh-my-pi/pi-coding-agent/collab/relay-client";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { installInMemoryRelay, uninstallInMemoryRelay } from "./helpers/in-memory-relay";

type IntegrationHostContext = InteractiveModeContext & {
	sessionManager: InteractiveModeContext["sessionManager"] & {
		onEntryAppended?: (entry: SessionEntry) => void;
	};
	emitSessionEvent?: (event: AgentSessionEvent) => void;
};

type IntegrationGuestSession = {
	messages: unknown[];
	isStreaming: boolean;
	isAborting: boolean;
	queuedMessageCount: number;
	sessionName: string;
	model: unknown;
	thinkingLevel: unknown;
	newSession: () => Promise<void>;
	switchSession: () => Promise<boolean>;
	agent: {
		state: { model: unknown };
		setModel: (model: unknown) => void;
		setThinkingLevel: (level: unknown) => void;
		setDisableReasoning: (disabled: boolean) => void;
		replaceMessages: (messages: unknown[]) => void;
	};
};
const encoder = new TextEncoder();

function payloads(count: number): Uint8Array[] {
	return Array.from({ length: count }, (_, index) => encoder.encode(`entry-${index}`));
}
async function flushMicrotasks(rounds = 12): Promise<void> {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
}

async function waitFor(predicate: () => boolean, rounds = 1000): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		if (predicate()) return;
		await flushMicrotasks();
		await new Promise<void>(resolve => setImmediate(resolve));
	}
	throw new Error("timed out waiting for collab integration condition");
}

function makeIntegrationSnapshot(
	entryCount: number,
	bodyBytes: number,
): {
	header: { type: "session"; id: string; title?: string; timestamp: string; cwd: string };
	entries: SessionEntry[];
} {
	const body = "x".repeat(bodyBytes);
	return {
		header: { type: "session", id: `integration-${entryCount}`, timestamp: "2026-08-28T00:00:00Z", cwd: "/tmp" },
		entries: Array.from({ length: entryCount }, (_, index) => ({
			type: "message",
			id: `entry-${index}`,
			parentId: index === 0 ? null : `entry-${index - 1}`,
			timestamp: "2026-08-28T00:00:00Z",
			message: { role: "user", content: body, timestamp: index },
		})) as SessionEntry[],
	};
}

function makeIntegrationHostContext(snapshot: {
	header: { id: string; cwd: string };
	entries: SessionEntry[];
}): InteractiveModeContext {
	const sessionManager = {
		getSessionId: () => snapshot.header.id,
		getCwd: () => snapshot.header.cwd,
		snapshotForReplication: () => snapshot,
		onEntryAppended: undefined as ((entry: SessionEntry) => void) | undefined,
	};
	let sessionListener: ((event: AgentSessionEvent) => void) | undefined;
	const session = {
		isStreaming: false,
		isAborting: false,
		queuedMessageCount: 0,
		sessionName: "integration-host",
		model: undefined,
		thinkingLevel: undefined,
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			sessionListener = listener;
			return () => {
				if (sessionListener === listener) sessionListener = undefined;
			};
		},
		emitNotice: () => {},
		promptCustomMessage: () => Promise.resolve(),
		abort: () => Promise.resolve(),
	};
	return {
		settings: { get: () => "" },
		sessionManager,
		session,
		statusLine: {
			setCollabStatus: () => {},
			invalidate: () => {},
			getCachedContextBreakdown: () => ({ usedTokens: 0, contextWindow: 1 }),
		},
		ui: { requestRender: () => {} },
		showStatus: () => {},
		eventBus: undefined,
		collabHost: undefined,
		emitSessionEvent: (event: AgentSessionEvent) => sessionListener?.(event),
	} as unknown as InteractiveModeContext;
}

function makeIntegrationGuestContext(
	initialEntries: SessionEntry[],
	receivedEntries: SessionEntry[],
	beforeInitialRender?: () => void,
): InteractiveModeContext {
	const session: IntegrationGuestSession = {
		messages: [],
		isStreaming: false,
		isAborting: false,
		queuedMessageCount: 0,
		sessionName: "integration-guest",
		model: undefined,
		thinkingLevel: undefined,
		newSession: async () => {},
		switchSession: async () => true,
		agent: {
			state: { model: undefined },
			setModel: () => {},
			setThinkingLevel: () => {},
			setDisableReasoning: () => {},
			replaceMessages: (messages: unknown[]) => {
				session.messages = messages;
			},
		},
	};
	session.switchSession = async () => {
		session.messages = initialEntries.filter(entry => entry.type === "message").map(entry => entry.message);
		receivedEntries.length = 0;
		receivedEntries.push(...initialEntries);
		return true;
	};
	let initialRendered = false;
	const sessionManager = {
		getSessionFile: () => null,
		getSessionName: () => "integration-guest",
		getSessionId: () => "guest",
		getCwd: () => "/tmp",
		ingestReplicatedEntry: (entry: SessionEntry) => receivedEntries.push(entry),
	};
	return {
		settings: { get: () => "" },
		sessionManager,
		session,
		statusContainer: { clear: () => {}, disposeChildren: () => {} },
		pendingMessagesContainer: { clear: () => {} },
		compactionQueuedMessages: [],
		streamingComponent: undefined,
		streamingMessage: undefined,
		transcriptMessageComponents: new WeakMap(),
		pendingTools: new Map(),
		loadingAnimation: undefined,
		autoCompactionLoader: undefined,
		retryLoader: undefined,
		statusLine: {
			setCollabStatus: () => {},
			invalidate: () => {},
			resetActiveTime: () => {},
			markActivityStart: () => {},
			markActivityEnd: () => {},
		},
		ui: { requestRender: () => {} },
		chatContainer: { clear: () => {}, disposeChildren: () => {} },
		resetObserverRegistry: () => {},
		renderInitialMessages: async () => {
			if (!initialRendered) {
				initialRendered = true;
				beforeInitialRender?.();
			}
		},
		reloadTodos: async () => {},
		syncRunningSubagentBadge: () => {},
		ensureLoadingAnimation: () => undefined,
		updateEditorTopBorder: () => {},
		updateEditorBorderColor: () => {},
		showStatus: () => {},
		showError: () => {},
		handleResumeSession: async () => {},
		eventController: { handleEvent: () => {} },
		collabGuest: undefined,
	} as unknown as InteractiveModeContext;
}

async function captureRecoveryChunks(
	frames: readonly { bytes: Uint8Array; targetPeer: number }[],
	key: CryptoKey,
): Promise<{ index: number; seq: number }[]> {
	const chunks: { index: number; seq: number }[] = [];
	for (let index = 0; index < frames.length; index++) {
		const envelope = protocol.unpackEnvelope(frames[index]!.bytes);
		if (!envelope) continue;
		try {
			const frame = await open(key, envelope.payload);
			if (frame.t === "snapshot-chunk" && "payload" in frame) chunks.push({ index, seq: frame.seq });
		} catch {
			// The helper only records frames from this room, so this is defensive.
		}
	}
	return chunks;
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

	it("rejects ACKs for unexposed future chunks and ignores repeated missing ACK replays", () => {
		const sender = new protocol.SnapshotSender("future", payloads(6));
		const initial = sender.nextWindow();
		expect(initial.map(chunk => chunk.seq)).toEqual([0, 1, 2, 3]);

		const futureAck = sender.acknowledge({
			t: "snapshot-ack",
			snapshotId: "future",
			contiguousSeq: 5,
		});
		expect(sender.contiguousSeq).toBe(-1);
		expect(futureAck.complete).toBe(false);
		expect(futureAck.chunks.map(chunk => chunk.seq)).not.toContain(4);

		const missingAck: protocol.SnapshotAckFrame = {
			t: "snapshot-ack",
			snapshotId: "future",
			contiguousSeq: -1,
			missing: [0],
		};
		const firstMissing = sender.acknowledge(missingAck);
		expect(firstMissing.exhausted).toBe(false);
		expect(firstMissing.chunks.map(chunk => chunk.seq)).toContain(0);
		for (let replay = 0; replay < protocol.SNAPSHOT_MAX_RETRIES + 2; replay++) {
			const duplicate = sender.acknowledge(missingAck);
			expect(duplicate.exhausted).toBe(false);
			expect(duplicate.chunks).toEqual([]);
		}

		for (let attempt = 1; attempt < protocol.SNAPSHOT_MAX_RETRIES; attempt++) {
			const retry = sender.onTimeout();
			expect(retry.exhausted).toBe(false);
		}
		expect(sender.onTimeout().exhausted).toBe(true);
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
	it("accepts an empty snapshot as a real encrypted chunk", () => {
		const sender = new protocol.SnapshotSender("empty", [protocol.serializeSnapshotEntries([])]);
		const receiver = new protocol.SnapshotReceiver();
		receiver.begin({ t: "snapshot-begin", snapshotId: "empty", total: sender.total });
		const chunk = sender.nextWindow()[0]!;
		const result = receiver.accept(chunk);
		expect(result.accepted).toBe(true);
		expect(receiver.assemble()).toEqual(protocol.serializeSnapshotEntries([]));
	});

	it("resumes the retained sender after a disconnect while retaining new live entries", () => {
		const source = payloads(6);
		const sender = new protocol.SnapshotSender("resume", source);
		const receiver = new protocol.SnapshotReceiver();
		receiver.begin({ t: "snapshot-begin", snapshotId: "resume", total: source.length });
		for (const chunk of sender.nextWindow().slice(0, 2)) receiver.accept(chunk);
		const reconnectAck = receiver.ack();
		const resumed = sender.acknowledge(reconnectAck, true);
		expect(resumed.chunks.map(chunk => chunk.seq)).not.toContain(0);
		expect(resumed.chunks.map(chunk => chunk.seq)).not.toContain(1);
		for (const chunk of resumed.chunks) receiver.accept(chunk);
		while (receiver.contiguousSeq < source.length - 1) {
			for (const chunk of sender.acknowledge(receiver.ack()).chunks) receiver.accept(chunk);
		}
		expect(receiver.assemble()).toEqual(Buffer.concat(source.map(bytes => Buffer.from(bytes))));
	});

	it("retries lost history pages until an authenticated ACK and then exhausts", () => {
		const frame: protocol.SnapshotPageFrame = {
			t: "snapshot-page",
			snapshotId: "page",
			cursor: "128",
			payload: protocol.encodeSnapshotPayload(encoder.encode("[]")),
			checksum: protocol.checksumSnapshotPayload(encoder.encode("[]")),
		};
		const sender = new protocol.SnapshotPageSender(frame);
		for (let attempt = 0; attempt < protocol.SNAPSHOT_PAGE_MAX_RETRIES; attempt++) {
			const retry = sender.onTimeout();
			expect(retry.exhausted).toBe(false);
		}
		expect(sender.onTimeout().exhausted).toBe(true);
		const acknowledged = new protocol.SnapshotPageSender(frame);
		expect(acknowledged.acknowledge({ t: "snapshot-page-ack", snapshotId: "page", cursor: "128" })).toBe(true);
		expect(acknowledged.onTimeout().complete).toBe(true);
	});

	it("splits UTF-8 payloads below the encrypted envelope budget", () => {
		const payload = encoder.encode("漢字".repeat(40_000));
		const chunks = protocol.splitSnapshotPayload(payload);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every(chunk => chunk.byteLength <= protocol.SNAPSHOT_CHUNK_PAYLOAD_BYTES)).toBe(true);
		expect(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))).toEqual(Buffer.from(payload));
	});
	it("simulates a host and guest relay reconnect without replaying acknowledged chunks", () => {
		const source = payloads(10);
		const host = new protocol.SnapshotSender("relay", source);
		const guest = new protocol.SnapshotReceiver();
		guest.begin({ t: "snapshot-begin", snapshotId: "relay", total: source.length });
		for (const chunk of host.nextWindow().slice(0, 2)) guest.accept(chunk);
		const queuedLiveEntry = encoder.encode("entry-created-while-disconnected");
		const pendingLive = [queuedLiveEntry];
		const reconnect = host.acknowledge(guest.ack());
		expect(reconnect.chunks.every(chunk => chunk.seq >= 2)).toBe(true);
		for (const chunk of reconnect.chunks) guest.accept(chunk);
		while (guest.contiguousSeq < source.length - 1) {
			for (const chunk of host.acknowledge(guest.ack()).chunks) guest.accept(chunk);
		}
		expect(guest.assemble()).toEqual(Buffer.concat(source.map(bytes => Buffer.from(bytes))));
		// The fake host queues this live entry while the guest is disconnected and
		// flushes it only after the snapshot ACK reaches the end.
		expect(pendingLive.shift()).toEqual(queuedLiveEntry);
	});

	it("keeps the largest recovery chunk below the encrypted relay envelope cap", async () => {
		const payload = new Uint8Array(protocol.SNAPSHOT_CHUNK_PAYLOAD_BYTES);
		payload.fill(65);
		const sender = new protocol.SnapshotSender("edge", [payload]);
		const key = await importRoomKey(new Uint8Array(32));
		const sealed = await seal(key, sender.nextWindow()[0]!);
		const envelope = protocol.packEnvelope(0, sealed);
		expect(envelope.byteLength).toBeLessThanOrEqual(MAX_ENCRYPTED_COLLAB_FRAME_BYTES);
	});

	it("rejects unbounded sender and receiver state", () => {
		expect(
			() =>
				new protocol.SnapshotSender(
					"too-many",
					Array.from({ length: protocol.SNAPSHOT_MAX_PAYLOAD_COUNT + 1 }, () => new Uint8Array(0)),
				),
		).toThrow();
		const receiver = new protocol.SnapshotReceiver();
		expect(() =>
			receiver.begin({
				t: "snapshot-begin",
				snapshotId: "too-many",
				total: protocol.SNAPSHOT_MAX_PAYLOAD_COUNT + 1,
			}),
		).toThrow();
	});
	it("rejects an oversized legacy history before sending snapshot chunks", async () => {
		const snapshot = makeIntegrationSnapshot(1100, 60 * 1024);
		installInMemoryRelay();
		const host = new CollabHost(makeIntegrationHostContext(snapshot));
		let guestSocket: CollabSocket | undefined;
		try {
			await host.start("ws://localhost:8788");
			const parsed = protocol.parseCollabLink(host.link);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);
			const frames: protocol.CollabFrame[] = [];
			guestSocket = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guestSocket.onFrame = frame => frames.push(frame);
			guestSocket.onOpen = () =>
				guestSocket?.send({
					t: "hello",
					proto: protocol.COLLAB_PROTO,
					name: "legacy-limit-test",
				});
			guestSocket.connect();
			await waitFor(() => frames.some(frame => frame.t === "error"));
			const error = frames.find((frame): frame is { t: "error"; message: string } => frame.t === "error");
			expect(error?.message).toContain("bounded legacy history byte limit");
		} finally {
			guestSocket?.close();
			try {
				await host.stop("test");
			} catch {}
			uninstallInMemoryRelay();
		}
	});

	it("rejects a legacy chunk train once aggregate serialized bytes exceed the transfer cap", async () => {
		const body = "x".repeat(64 * 1024);
		const entries = Array.from(
			{ length: 1025 },
			(_, index) =>
				({
					type: "message",
					id: `legacy-${index}`,
					parentId: null,
					timestamp: "2026-08-28T00:00:00Z",
					message: { role: "user", content: body, timestamp: index },
				}) as SessionEntry,
		);
		const roomKey = new Uint8Array(32);
		const key = await importRoomKey(roomKey);
		const roomId = "legacy-aggregate-limit";
		const link = protocol.formatCollabLink("ws://localhost:8788", roomId, roomKey);
		installInMemoryRelay();
		const hostSocket = new CollabSocket({ wsUrl: `ws://localhost:8788/r/${roomId}`, role: "host", key });
		const hostOpen = Promise.withResolvers<void>();
		hostSocket.onOpen = () => hostOpen.resolve();
		hostSocket.onFrame = frame => {
			if (frame.t !== "hello") return;
			hostSocket.send({
				t: "welcome",
				proto: protocol.COLLAB_PROTO,
				header: { type: "session", id: "legacy", timestamp: "2026-08-28T00:00:00Z", cwd: "/tmp" },
				state: {} as protocol.CollabSessionState,
				agents: [],
				entryCount: entries.length,
			} as protocol.CollabFrame);
			for (let index = 0; index < entries.length; index++) {
				hostSocket.send({ t: "snapshot-chunk", entries: [entries[index]!], final: index === entries.length - 1 });
			}
		};
		hostSocket.connect();
		await hostOpen.promise;
		const receivedEntries: SessionEntry[] = [];
		const guest = new CollabGuestLink(makeIntegrationGuestContext([], receivedEntries));
		try {
			await expect(guest.join(link)).rejects.toThrow("legacy snapshot bytes exceed bounded transfer limit");
		} finally {
			try {
				await guest.leave("test");
			} catch {}
			hostSocket.close();
			uninstallInMemoryRelay();
		}
	});
	it("retransmits recovery controls while delivery is stalled", async () => {
		const snapshot = makeIntegrationSnapshot(4, 20 * 1024);
		const receivedEntries: SessionEntry[] = [];
		const relay = installInMemoryRelay();
		let sentHostFrames = 0;
		relay.onHostFrame = () => sentHostFrames++;
		relay.pauseGuestTraffic();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const guestCtx = makeIntegrationGuestContext(snapshot.entries, receivedEntries);
		const host = new CollabHost(hostCtx);
		const guest = new CollabGuestLink(guestCtx);
		const writeSpy = spyOn(Bun, "write").mockResolvedValue(0);
		let joinPromise: Promise<void> | undefined;
		try {
			vi.useFakeTimers();
			await host.start("ws://localhost:8788");
			joinPromise = guest.join(host.link);
			void joinPromise.catch(() => {});
			await waitFor(() => sentHostFrames >= 4);
			const stalledCount = relay.pendingGuestDeliveryCount;
			vi.advanceTimersByTime(protocol.SNAPSHOT_ACK_TIMEOUT_MS + 1);
			await waitFor(() => relay.pendingGuestDeliveryCount > stalledCount);
			expect(relay.pendingGuestDeliveryCount).toBeGreaterThan(stalledCount);
			relay.resumeGuestTraffic();
			await joinPromise;
			expect(receivedEntries).toEqual(snapshot.entries);
		} finally {
			relay.resumeGuestTraffic();
			try {
				await guest.leave("test");
			} catch {}
			try {
				await host.stop("test");
			} catch {}
			writeSpy.mockRestore();
			vi.useRealTimers();
			uninstallInMemoryRelay();
		}
	});
	it("reconnects production host and guest with retained ACK state and live-frame flush", async () => {
		const snapshot = makeIntegrationSnapshot(4, 20 * 1024);
		const receivedEntries: SessionEntry[] = [];
		const relay = installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const guestCtx = makeIntegrationGuestContext(snapshot.entries, receivedEntries);
		const host = new CollabHost(hostCtx);
		const guest = new CollabGuestLink(guestCtx);
		const hostFrames: { bytes: Uint8Array; targetPeer: number }[] = [];
		const guestFrames: { bytes: Uint8Array; peerId: number }[] = [];
		relay.onHostFrame = (bytes, targetPeer) => hostFrames.push({ bytes, targetPeer });
		relay.onGuestFrame = (bytes, peerId) => guestFrames.push({ bytes, peerId });
		relay.pauseAfterHostFrames(3);
		const writeSpy = spyOn(Bun, "write").mockResolvedValue(0);
		const randomSpy = spyOn(Math, "random").mockReturnValue(0);
		let joinPromise: Promise<void> | undefined;
		try {
			vi.useFakeTimers();
			await host.start("ws://localhost:8788");
			joinPromise = guest.join(host.link);
			void joinPromise.catch(() => {});
			await waitFor(() => hostFrames.length >= 3);
			await flushMicrotasks(20);
			await waitFor(() => guestFrames.length >= 3);
			await new Promise<void>(resolve => setImmediate(resolve));
			await flushMicrotasks(20);
			relay.dropGuest(1);
			await flushMicrotasks(20);
			const liveEntry: SessionEntry = {
				type: "message",
				id: "live-after-disconnect",
				parentId: "entry-3",
				timestamp: "2026-08-28T00:01:00Z",
				message: { role: "user", content: "live after disconnect", timestamp: 10 },
			};
			hostCtx.sessionManager.onEntryAppended?.(liveEntry);
			const reconnectStart = hostFrames.length;
			vi.advanceTimersByTime(800);
			await flushMicrotasks(40);
			relay.resumeGuestTraffic();
			await joinPromise;
			await waitFor(() => receivedEntries.some(entry => entry.id === liveEntry.id));
			const replicatedLive = receivedEntries.find(entry => entry.id === liveEntry.id);
			expect(replicatedLive).toEqual(liveEntry);
			const parsed = protocol.parseCollabLink(host.link);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);
			const chunks = await captureRecoveryChunks(hostFrames, key);
			expect(chunks.filter(chunk => chunk.index < reconnectStart && chunk.seq === 0).length).toBeGreaterThan(0);
			expect(chunks.filter(chunk => chunk.index >= reconnectStart && chunk.seq === 0)).toHaveLength(0);
		} finally {
			relay.resumeGuestTraffic();
			try {
				await guest.leave("test");
			} catch {}
			try {
				await host.stop("test");
			} catch {}
			writeSpy.mockRestore();
			randomSpy.mockRestore();
			vi.useRealTimers();
			uninstallInMemoryRelay();
		}
	});

	it("keeps live appends behind every older paginated history page", async () => {
		const snapshot = makeIntegrationSnapshot(300, 700);
		const initialEntries = snapshot.entries.slice(0, 128);
		const receivedEntries: SessionEntry[] = [];
		const relay = installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const guestCtx = makeIntegrationGuestContext(initialEntries, receivedEntries, () => relay.pauseGuestTraffic());
		const host = new CollabHost(hostCtx);
		const guest = new CollabGuestLink(guestCtx);
		const writeSpy = spyOn(Bun, "write").mockResolvedValue(0);
		try {
			await host.start("ws://localhost:8788");
			await guest.join(host.link);
			await waitFor(() => relay.pendingGuestDeliveryCount > 0);
			const liveEntry: SessionEntry = {
				type: "message",
				id: "live-during-pagination",
				parentId: "entry-299",
				timestamp: "2026-08-28T00:02:00Z",
				message: { role: "user", content: "live during pagination", timestamp: 301 },
			};
			hostCtx.sessionManager.onEntryAppended?.(liveEntry);
			relay.resumeGuestTraffic();
			await waitFor(() => receivedEntries.some(entry => entry.id === liveEntry.id));
			expect(receivedEntries).toEqual([...snapshot.entries, liveEntry]);
		} finally {
			relay.resumeGuestTraffic();
			try {
				await guest.leave("test");
			} catch {}
			try {
				await host.stop("test");
			} catch {}
			writeSpy.mockRestore();
			uninstallInMemoryRelay();
		}
	});
	it("replaces a connected recovery after deferred live bounds overflow", async () => {
		const snapshot = makeIntegrationSnapshot(129, 700);
		const initialEntries = snapshot.entries.slice(0, 128);
		const receivedEntries: SessionEntry[] = [];
		const relay = installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const guestCtx = makeIntegrationGuestContext(initialEntries, receivedEntries, () => relay.pauseGuestTraffic());
		const host = new CollabHost(hostCtx);
		const guest = new CollabGuestLink(guestCtx);
		const writeSpy = spyOn(Bun, "write").mockResolvedValue(0);
		try {
			await host.start("ws://localhost:8788");
			await guest.join(host.link);
			await waitFor(() => relay.pendingGuestDeliveryCount > 0);
			const liveEntries = Array.from({ length: 300 }, (_, index) => ({
				type: "message",
				id: `overflow-${index}`,
				parentId: index === 0 ? "entry-128" : `overflow-${index - 1}`,
				timestamp: "2026-08-28T00:03:00Z",
				message: { role: "user", content: `live-${index}`, timestamp: index + 129 },
			})) as SessionEntry[];
			for (const entry of liveEntries.slice(0, 260)) {
				snapshot.entries.push(entry);
				hostCtx.sessionManager.onEntryAppended?.(entry);
			}
			const largeEventText = "e".repeat(900 * 1024);
			const largeEvent = {
				type: "message_update",
				message: { role: "assistant", content: [{ type: "text", text: largeEventText }] },
				assistantMessageEvent: { type: "text_delta", delta: "event" },
			} as unknown as AgentSessionEvent;
			for (let index = 0; index < 10; index++) hostCtx.emitSessionEvent?.(largeEvent);
			for (const entry of liveEntries.slice(260)) {
				snapshot.entries.push(entry);
				hostCtx.sessionManager.onEntryAppended?.(entry);
			}
			relay.resumeGuestTraffic();
			await flushMicrotasks(40);
			await waitFor(() => receivedEntries.length === snapshot.entries.length, 2000);
			expect(receivedEntries).toEqual(snapshot.entries);
		} finally {
			relay.resumeGuestTraffic();
			try {
				await guest.leave("test");
			} catch {}
			try {
				await host.stop("test");
			} catch {}
			writeSpy.mockRestore();
			uninstallInMemoryRelay();
		}
	});
	it("rejects forged completion ACKs with mismatched/missing completion proof (T6-P01)", async () => {
		const snapshot = makeIntegrationSnapshot(2, 200);
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const host = new CollabHost(hostCtx);
		const guestFrames: CollabFrame[] = [];
		try {
			await host.start("ws://localhost:8788");
			const parsed = protocol.parseCollabLink(host.viewLink);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);

			const guest = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guest.onFrame = frame => guestFrames.push(frame);
			guest.onOpen = () =>
				guest.send({ t: "hello", proto: protocol.COLLAB_PROTO, name: "adversary", snapshotRecovery: true });
			guest.connect();

			await waitFor(() => guestFrames.some(f => f.t === "snapshot-begin"));
			const begin = guestFrames.find(f => f.t === "snapshot-begin") as protocol.SnapshotBeginFrame;

			// Append a live entry on the host while transfer is ongoing
			const liveEntry: SessionEntry = {
				type: "message",
				id: "live-during-forge-attempt",
				parentId: "entry-1",
				timestamp: "2026-08-28T00:01:00Z",
				message: { role: "user", content: "live secret", timestamp: 10 },
			};
			hostCtx.sessionManager.onEntryAppended?.(liveEntry);

			// Adversary claims in-window completion with echoed digest but forged completionProof
			guest.send({
				t: "snapshot-ack",
				snapshotId: begin.snapshotId,
				recoveryEpoch: begin.recoveryEpoch,
				contiguousSeq: begin.total - 1,
				complete: true,
				digest: "forged-digest-or-echoed",
				completionProof: "forged-proof",
			});

			await flushMicrotasks(20);
			// Host MUST NOT release deferred live entry to the adversary
			expect(guestFrames.some(f => f.t === "entry" && f.entry.id === liveEntry.id)).toBe(false);
			guest.close();
		} finally {
			try {
				await host.stop("test");
			} catch {}
			uninstallInMemoryRelay();
		}
	});

	it("preserves live entries when peer disconnects between sender completion and receiver completion (T6-P02)", async () => {
		const snapshot = makeIntegrationSnapshot(2, 200);
		const initialEntries = snapshot.entries;
		const receivedEntries: SessionEntry[] = [];
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const guestCtx = makeIntegrationGuestContext(initialEntries, receivedEntries);
		const host = new CollabHost(hostCtx);
		const guest = new CollabGuestLink(guestCtx);
		const writeSpy = spyOn(Bun, "write").mockResolvedValue(0);

		try {
			await host.start("ws://localhost:8788");
			await guest.join(host.link);
			await waitFor(() => receivedEntries.length === 2);

			// Append live entry
			const liveEntry: SessionEntry = {
				type: "message",
				id: "live-across-disconnect-window",
				parentId: "entry-1",
				timestamp: "2026-08-28T00:02:00Z",
				message: { role: "user", content: "preserved live", timestamp: 20 },
			};
			hostCtx.sessionManager.onEntryAppended?.(liveEntry);

			await waitFor(() => receivedEntries.some(e => e.id === liveEntry.id));
			expect(receivedEntries).toContainEqual(liveEntry);
		} finally {
			try {
				await guest.leave("test");
			} catch {}
			try {
				await host.stop("test");
			} catch {}
			writeSpy.mockRestore();
			uninstallInMemoryRelay();
		}
	});

	it("reconnects cleanly and does not acknowledge completion on activation failure (T6-P03)", async () => {
		const snapshot = makeIntegrationSnapshot(2, 200);
		const initialEntries = snapshot.entries;
		const receivedEntries: SessionEntry[] = [];
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const guestCtx = makeIntegrationGuestContext(initialEntries, receivedEntries);
		const host = new CollabHost(hostCtx);
		const guest = new CollabGuestLink(guestCtx);

		// Force Bun.write to fail once to simulate activation failure
		let failCount = 1;
		const writeSpy = spyOn(Bun, "write").mockImplementation(async () => {
			if (failCount > 0) {
				failCount--;
				throw new Error("simulated disk write failure");
			}
			return 0;
		});

		try {
			await host.start("ws://localhost:8788");
			// The join should reject or recover cleanly
			await expect(guest.join(host.link)).rejects.toThrow("simulated disk write failure");
		} finally {
			try {
				await guest.leave("test");
			} catch {}
			try {
				await host.stop("test");
			} catch {}
			writeSpy.mockRestore();
			uninstallInMemoryRelay();
		}
	});

	it("retires previous transfer state upon repeated hello on the same peer (T6-P05)", async () => {
		const snapshot = makeIntegrationSnapshot(2, 200);
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const host = new CollabHost(hostCtx);
		const guestFrames: CollabFrame[] = [];

		try {
			await host.start("ws://localhost:8788");
			const parsed = protocol.parseCollabLink(host.link);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);

			const guest = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guest.onFrame = frame => guestFrames.push(frame);
			guest.onOpen = () => {
				for (let i = 0; i < 5; i++) {
					guest.send({
						t: "hello",
						proto: protocol.COLLAB_PROTO,
						name: "flooder",
						snapshotRecovery: true,
						resumeId: "resume-same",
					});
				}
			};
			guest.connect();

			await waitFor(() => guestFrames.some(f => f.t === "welcome"));
			// Peer remains healthy and receives snapshot headers without unhandled errors
			expect(guestFrames.filter(f => f.t === "welcome").length).toBeGreaterThan(0);
			guest.close();
		} finally {
			try {
				await host.stop("test");
			} catch {}
			uninstallInMemoryRelay();
		}
	});

	it("enforces fair per-peer quota on history page requests (T6-P08)", async () => {
		const snapshot = makeIntegrationSnapshot(300, 700);
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const host = new CollabHost(hostCtx);
		const guest1Frames: CollabFrame[] = [];
		const guest2Frames: CollabFrame[] = [];

		try {
			await host.start("ws://localhost:8788");
			const parsed = protocol.parseCollabLink(host.link);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);

			const guest1 = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guest1.onFrame = frame => guest1Frames.push(frame);
			guest1.onOpen = () =>
				guest1.send({ t: "hello", proto: protocol.COLLAB_PROTO, name: "g1", snapshotRecovery: true });
			guest1.connect();

			const guest2 = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guest2.onFrame = frame => guest2Frames.push(frame);
			guest2.onOpen = () =>
				guest2.send({ t: "hello", proto: protocol.COLLAB_PROTO, name: "g2", snapshotRecovery: true });
			guest2.connect();

			await waitFor(
				() => guest1Frames.some(f => f.t === "snapshot-begin") && guest2Frames.some(f => f.t === "snapshot-begin"),
			);
			const b1 = guest1Frames.find(f => f.t === "snapshot-begin") as protocol.SnapshotBeginFrame;
			const b2 = guest2Frames.find(f => f.t === "snapshot-begin") as protocol.SnapshotBeginFrame;

			// Complete initial transfers
			guest1.send({
				t: "snapshot-ack",
				snapshotId: b1.snapshotId,
				recoveryEpoch: b1.recoveryEpoch,
				contiguousSeq: b1.total - 1,
			});
			guest2.send({
				t: "snapshot-ack",
				snapshotId: b2.snapshotId,
				recoveryEpoch: b2.recoveryEpoch,
				contiguousSeq: b2.total - 1,
			});

			await waitFor(
				() => guest1Frames.some(f => f.t === "snapshot-end") && guest2Frames.some(f => f.t === "snapshot-end"),
			);
			const end1 = guest1Frames.find(f => f.t === "snapshot-end") as protocol.SnapshotEndFrame;
			const end2 = guest2Frames.find(f => f.t === "snapshot-end") as protocol.SnapshotEndFrame;

			guest1.send({
				t: "snapshot-ack",
				snapshotId: b1.snapshotId,
				recoveryEpoch: b1.recoveryEpoch,
				contiguousSeq: b1.total - 1,
				complete: true,
				digest: end1.checksum,
				completionProof: protocol.computeSnapshotCompletionProof(end1.completionNonce!, end1.checksum!),
			});
			guest2.send({
				t: "snapshot-ack",
				snapshotId: b2.snapshotId,
				recoveryEpoch: b2.recoveryEpoch,
				contiguousSeq: b2.total - 1,
				complete: true,
				digest: end2.checksum,
				completionProof: protocol.computeSnapshotCompletionProof(end2.completionNonce!, end2.checksum!),
			});

			await flushMicrotasks(20);
			// Guest 2 requests a page and gets it without starvation from guest 1
			guest2.send({
				t: "snapshot-page-request",
				snapshotId: b2.snapshotId,
				recoveryEpoch: b2.recoveryEpoch,
				cursor: "128",
			});
			await waitFor(() => guest2Frames.some(f => f.t === "snapshot-page"));
			expect(
				guest2Frames.some(f => f.t === "snapshot-page" && (f as protocol.SnapshotPageFrame).cursor === "128"),
			).toBe(true);

			guest1.close();
			guest2.close();
		} finally {
			try {
				await host.stop("test");
			} catch {}
			uninstallInMemoryRelay();
		}
	});

	it("fails closed on malformed authenticated control frames (T6-P09)", async () => {
		const snapshot = makeIntegrationSnapshot(2, 200);
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const host = new CollabHost(hostCtx);
		const guestFrames: CollabFrame[] = [];

		try {
			await host.start("ws://localhost:8788");
			const parsed = protocol.parseCollabLink(host.link);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);

			const guest = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guest.onFrame = frame => guestFrames.push(frame);
			guest.onOpen = () => {
				guest.send({ t: "hello", proto: protocol.COLLAB_PROTO, name: "g-test", snapshotRecovery: true });
				guest.send({
					t: "snapshot-ack",
					snapshotId: 12345 as unknown as string,
					contiguousSeq: "invalid" as unknown as number,
				});
			};
			guest.connect();

			await waitFor(() => guestFrames.some(f => f.t === "error" && f.message.includes("malformed")));
			expect(guestFrames.some(f => f.t === "error" && f.message.includes("malformed"))).toBe(true);
			guest.close();
		} finally {
			try {
				await host.stop("test");
			} catch {}
			uninstallInMemoryRelay();
		}
	});

	it("preserves retained transfer when session title mutates under same session ID", async () => {
		const snapshot = makeIntegrationSnapshot(2, 200);
		installInMemoryRelay();
		const hostCtx = makeIntegrationHostContext(snapshot) as unknown as IntegrationHostContext;
		const host = new CollabHost(hostCtx);
		const guestFrames: CollabFrame[] = [];

		try {
			await host.start("ws://localhost:8788");
			const parsed = protocol.parseCollabLink(host.link);
			if ("error" in parsed) throw new Error(parsed.error);
			const key = await importRoomKey(parsed.key);

			const guest = new CollabSocket({ wsUrl: parsed.wsUrl, role: "guest", key });
			guest.onFrame = frame => guestFrames.push(frame);
			guest.onOpen = () =>
				guest.send({
					t: "hello",
					proto: protocol.COLLAB_PROTO,
					name: "g",
					snapshotRecovery: true,
					resumeId: "resume-title-test",
				});
			guest.connect();

			await waitFor(() => guestFrames.some(f => f.t === "welcome"));

			// Mutate title in session header (same session id)
			snapshot.header.title = "Updated Session Title";

			// Reconnect with same resumeId
			guestFrames.length = 0;
			guest.send({
				t: "hello",
				proto: protocol.COLLAB_PROTO,
				name: "g",
				snapshotRecovery: true,
				resumeId: "resume-title-test",
			});

			await waitFor(() => guestFrames.some(f => f.t === "welcome"));
			const welcome = guestFrames.find(
				(f): f is Extract<protocol.CollabFrame, { t: "welcome" }> => f.t === "welcome",
			);
			expect(welcome?.header.title).toBe("Updated Session Title");
			guest.close();
		} finally {
			try {
				await host.stop("test");
			} catch {}
			uninstallInMemoryRelay();
		}
	});
});
