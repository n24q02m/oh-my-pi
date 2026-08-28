/**
 * Host side of a collab live session.
 *
 * Taps the host session's event stream and SessionManager append chokepoint,
 * broadcasting entries/events/state to guests through the relay. Guests prompt
 * and abort through us; the host machine runs the agent and tools. The host's
 * subagent ecosystem is mirrored too: task EventBus traffic (observer HUD),
 * agent-registry snapshots (Agent Hub table), hub chat/kill/revive commands,
 * and incremental subagent-transcript reads.
 */

import { timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import type {
	BusChannel,
	CollabUiRequest,
	CollabUiRequestDraft,
	CollabUiResponseValue,
	AgentEvent as WireAgentEvent,
	SessionEntry as WireSessionEntry,
} from "@oh-my-pi/pi-wire";
import type { InteractiveModeContext } from "../modes/types";
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { type AgentRef, AgentRegistry } from "../registry/agent-registry";
import type { AgentSessionEvent } from "../session/agent-session";
import { stripImagesFromMessage, USER_INTERRUPT_LABEL } from "../session/messages";
import type { SessionEntry as StoredSessionEntry } from "../session/session-entries";
import { TASK_SUBAGENT_LIFECYCLE_CHANNEL, TASK_SUBAGENT_PROGRESS_CHANNEL } from "../task/types";
import { generateRoomKey, generateWriteToken, importRoomKey } from "./crypto";
import { collabDisplayName } from "./display-name";
import {
	type AgentSnapshot,
	COLLAB_PROMPT_MESSAGE_TYPE,
	COLLAB_PROTO,
	type CollabFrame,
	type CollabParticipant,
	type CollabPromptDetails,
	type CollabSessionState,
	checksumSnapshotPayload,
	encodeSnapshotPayload,
	formatCollabLink,
	formatCollabWebLink,
	generateRoomId,
	parseCollabLink,
	SNAPSHOT_ACK_TIMEOUT_MS,
	SNAPSHOT_CHUNK_PAYLOAD_BYTES,
	SNAPSHOT_HISTORY_PAGE_ENTRIES,
	SNAPSHOT_INITIAL_HISTORY_ENTRIES,
	SNAPSHOT_MAX_RETAINED_TRANSFERS,
	SNAPSHOT_RESUME_RETENTION_MS,
	type SnapshotAckFrame,
	type SnapshotChunkFrame,
	type SnapshotHello,
	type SnapshotPageRequestFrame,
	SnapshotSender,
	serializeSnapshotEntries,
	splitSnapshotPayload,
} from "./protocol";
import { CollabSocket } from "./relay-client";
import { shrinkForReplication } from "./replication-shrink";

/** Events that change the footer state guests render. */
const STATE_TRIGGER_EVENTS: Record<string, true> = {
	agent_start: true,
	agent_end: true,
	message_end: true,
	tool_execution_end: true,
	thinking_level_changed: true,
	model_changed: true,
	advisor_cost_changed: true,
	auto_compaction_end: true,
};

const STATE_DEBOUNCE_MS = 100;
const AGENTS_DEBOUNCE_MS = 100;
const STREAMING_STATE_INTERVAL_MS = 2000;
const WELCOME_IMAGE_STRIP_THRESHOLD = 24 * 1024 * 1024;
const WIRE_AGENT_EVENT_TYPES: Record<WireAgentEvent["type"], true> = {
	agent_start: true,
	agent_end: true,
	turn_start: true,
	turn_end: true,
	message_start: true,
	message_update: true,
	message_end: true,
	tool_execution_start: true,
	tool_execution_update: true,
	tool_execution_end: true,
	notice: true,
	auto_compaction_start: true,
	auto_compaction_end: true,
	auto_retry_start: true,
	auto_retry_end: true,
	thinking_level_changed: true,
};

const WIRE_SESSION_ENTRY_TYPES: Record<WireSessionEntry["type"], true> = {
	message: true,
	custom_message: true,
	compaction: true,
	branch_summary: true,
	model_change: true,
	thinking_level_change: true,
};
const COLLAB_BUS_CHANNELS = [
	TASK_SUBAGENT_LIFECYCLE_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
] as const satisfies readonly BusChannel[];

function isWireAgentEvent(event: AgentSessionEvent): event is AgentSessionEvent & WireAgentEvent {
	return event.type in WIRE_AGENT_EVENT_TYPES;
}

function isWireSessionEntry(entry: StoredSessionEntry): entry is StoredSessionEntry & WireSessionEntry {
	return entry.type in WIRE_SESSION_ENTRY_TYPES;
}
const CONNECT_TIMEOUT_MS = 15_000;
/** Max bytes served per fetch-transcript reply (guest re-requests from `newSize`). */
export const TRANSCRIPT_READ_CAP = 4 * 1024 * 1024;
const TRANSCRIPT_ENTRY_TOO_LARGE_ERROR = `transcript entry exceeds transcript fetch cap (${TRANSCRIPT_READ_CAP} bytes)`;
/**
 * Soft byte cap per `snapshot-chunk` frame. The first MB of a snapshot takes
 * ~3s through the default relay, so a 512 KB chunk lands well under the
 * guest's 30 s per-chunk progress timeout; oversized single entries still
 * ship in a chunk of their own.
 */
const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/**
 * Outcome of {@link CollabHost.requestGuestUi}. `answered` carries the guest's
 * response (an `undefined` value is a genuine guest cancel); `unavailable`
 * means the collab channel went away (teardown, relay drop) or the request was
 * aborted before any guest answered — callers MUST NOT treat it as a cancel.
 */
export type CollabGuestUiResult = { kind: "answered"; value: CollabUiResponseValue } | { kind: "unavailable" };

const MAX_DEFERRED_LIVE_FRAMES = 256;

type SnapshotTransfer = {
	resumeId: string;
	snapshotId: string;
	sender: SnapshotSender;
	entries: (StoredSessionEntry & WireSessionEntry)[];
	initialEntryCount: number;
	nextHistoryCursor?: string;
	peerId: number | null;
	pendingLive: CollabFrame[];
	ackTimer: Timer | null;
	retentionTimer: Timer | null;
	lastUsedAt: number;
	completed: boolean;
};

export class CollabHost {
	#ctx: InteractiveModeContext;
	#socket: CollabSocket | null = null;
	#link = "";
	#webLink = "";
	#viewLink = "";
	#webViewLink = "";
	#writeToken: Uint8Array | null = null;
	#sessionId = "";
	#unsubscribe?: () => void;
	#peers = new Map<number, { name: string; canWrite: boolean; recovery?: SnapshotTransfer }>();
	#snapshotTransfers = new Map<string, SnapshotTransfer>();
	#uiReqSeq = 0;
	#pendingUi = new Map<number, { request: CollabUiRequest; settle(result: CollabGuestUiResult): void }>();
	#lastStateJson = "";
	#stateDebounce: Timer | null = null;
	#streamingInterval: Timer | null = null;
	#agentsDebounce: Timer | null = null;
	#busUnsubscribers: (() => void)[] = [];
	#registryUnsubscribe?: () => void;
	#stopped = false;

	constructor(ctx: InteractiveModeContext) {
		this.#ctx = ctx;
	}

	get link(): string {
		return this.#link;
	}

	/** Browser deep link for the configured collab web UI. */
	get webLink(): string {
		return this.#webLink;
	}

	/** Read-only variant of {@link link}: bare room key, no write token. */
	get viewLink(): string {
		return this.#viewLink;
	}

	/** Read-only variant of {@link webLink}. */
	get webViewLink(): string {
		return this.#webViewLink;
	}

	get participants(): CollabParticipant[] {
		const list: CollabParticipant[] = [{ name: collabDisplayName(this.#ctx), role: "host" }];
		for (const peer of this.#peers.values()) {
			list.push({ name: peer.name, role: "guest", readOnly: peer.canWrite ? undefined : true });
		}
		return list;
	}

	requestGuestUi(request: CollabUiRequestDraft, signal?: AbortSignal): Promise<CollabGuestUiResult> | null {
		if (!this.#socket || !this.#hasWritablePeers()) return null;
		const reqId = ++this.#uiReqSeq;
		const fullRequest: CollabUiRequest = { ...request, reqId };
		const { promise, resolve } = Promise.withResolvers<CollabGuestUiResult>();
		let settled = false;
		const settle = (result: CollabGuestUiResult): void => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			this.#pendingUi.delete(reqId);
			this.#sendWritablePeers({ t: "ui-request-end", reqId });
			resolve(result);
		};
		const onAbort = (): void => settle({ kind: "unavailable" });
		if (signal?.aborted) return Promise.resolve({ kind: "unavailable" });
		signal?.addEventListener("abort", onAbort, { once: true });
		this.#pendingUi.set(reqId, { request: fullRequest, settle });
		this.#sendWritablePeers({ t: "ui-request", request: fullRequest });
		return promise;
	}

	#hasWritablePeers(): boolean {
		for (const peer of this.#peers.values()) {
			if (peer.canWrite) return true;
		}
		return false;
	}

	#sendWritablePeers(frame: CollabFrame): void {
		const socket = this.#socket;
		if (!socket) return;
		for (const [peerId, peer] of this.#peers) {
			if (peer.canWrite) socket.send(frame, peerId);
		}
	}

	async start(relayUrl: string, webUrl = ""): Promise<void> {
		const rawKey = generateRoomKey();
		const writeToken = generateWriteToken();
		const roomId = generateRoomId();
		this.#writeToken = writeToken;
		this.#link = formatCollabLink(relayUrl, roomId, rawKey, writeToken);
		this.#webLink = formatCollabWebLink(relayUrl, roomId, rawKey, writeToken, webUrl);
		this.#viewLink = formatCollabLink(relayUrl, roomId, rawKey);
		this.#webViewLink = formatCollabWebLink(relayUrl, roomId, rawKey, undefined, webUrl);
		const parsed = parseCollabLink(this.#link);
		if ("error" in parsed) throw new Error(parsed.error);
		const key = await importRoomKey(rawKey);

		const socket = new CollabSocket({ wsUrl: parsed.wsUrl, role: "host", key });
		socket.onCorruptFrame = fromPeer => logger.debug("collab host ignored corrupted relay frame", { fromPeer });
		this.#socket = socket;
		this.#sessionId = this.#ctx.sessionManager.getSessionId();

		const firstOpen = Promise.withResolvers<void>();
		let opened = false;
		socket.onOpen = () => {
			if (!opened) {
				opened = true;
				firstOpen.resolve();
			}
		};
		socket.onFrame = (frame, fromPeer) => this.#handleFrame(frame, fromPeer);
		socket.onControl = msg => {
			if (msg.t === "peer-left") this.#handlePeerLeft(msg.peer);
		};
		socket.onClose = (reason, willReconnect) => {
			if (this.#stopped) return;
			if (!opened) {
				firstOpen.reject(new Error(reason));
				return;
			}
			if (willReconnect) {
				this.#ctx.showStatus(`Collab relay connection lost (${reason}), reconnecting…`, { dim: true });
			} else {
				void this.#teardown();
				this.#ctx.session.emitNotice("warning", `Collab ended: ${reason}`, "collab");
			}
		};
		socket.connect();

		const timeout = setTimeout(
			() => firstOpen.reject(new Error("timed out connecting to relay")),
			CONNECT_TIMEOUT_MS,
		);
		try {
			await firstOpen.promise;
		} catch (err) {
			this.#stopped = true;
			socket.close();
			this.#socket = null;
			throw err;
		} finally {
			clearTimeout(timeout);
		}

		this.#unsubscribe = this.#ctx.session.subscribe(event => {
			if (isWireAgentEvent(event)) this.#broadcast({ t: "event", event: shrinkForReplication(event) });
			this.#onEventForState(event);
		});
		// Subagent frames publish on the session tree's observability bus at
		// any spawn depth; mirroring from it is what lets nested agents reach
		// guests at all. Embedders on the previous constructor signature only
		// wire a session bus — fall back to it so depth-1 frames keep flowing.
		const observabilityBus = this.#ctx.subagentEventBus ?? this.#ctx.eventBus;
		if (observabilityBus) {
			for (const channel of COLLAB_BUS_CHANNELS) {
				this.#busUnsubscribers.push(
					observabilityBus.on(channel, data => this.#broadcast({ t: "bus", channel, data })),
				);
			}
		}
		this.#registryUnsubscribe = AgentRegistry.global().onChange(() => this.#scheduleAgentsBroadcast());
		this.#ctx.sessionManager.onEntryAppended = entry => {
			if (isWireSessionEntry(entry)) this.#broadcast({ t: "entry", entry: shrinkForReplication(entry) });
			// Model/thinking/title changes land as entries while idle; refresh
			// guest state promptly (debounce + JSON diff dedupe).
			this.#scheduleStateBroadcast();
		};
		this.#updateStatusSegment();
	}

	/** Broadcast a goodbye, detach all taps, and close the socket. */
	async stop(reason: string): Promise<void> {
		if (this.#stopped) return;
		this.#socket?.send({ t: "bye", reason });
		await this.#teardown();
	}

	async #teardown(): Promise<void> {
		if (this.#stopped) return;
		this.#stopped = true;
		this.#ctx.sessionManager.onEntryAppended = undefined;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		for (const unsubscribe of this.#busUnsubscribers) unsubscribe();
		this.#busUnsubscribers = [];
		this.#registryUnsubscribe?.();
		this.#registryUnsubscribe = undefined;
		clearTimeout(this.#stateDebounce ?? undefined);
		this.#stateDebounce = null;
		clearTimeout(this.#agentsDebounce ?? undefined);
		this.#agentsDebounce = null;
		clearInterval(this.#streamingInterval ?? undefined);
		for (const transfer of this.#snapshotTransfers.values()) {
			if (transfer.ackTimer !== null) clearTimeout(transfer.ackTimer);
			if (transfer.retentionTimer !== null) clearTimeout(transfer.retentionTimer);
		}
		this.#snapshotTransfers.clear();
		this.#streamingInterval = null;
		for (const pending of this.#pendingUi.values()) pending.settle({ kind: "unavailable" });
		this.#pendingUi.clear();
		this.#peers.clear();
		this.#socket?.close();
		this.#socket = null;
		this.#ctx.collabHost = undefined;
		this.#ctx.statusLine.setCollabStatus(null);
		this.#ctx.ui.requestRender();
	}

	#broadcast(frame: CollabFrame): void {
		if (this.#stopped || !this.#socket) return;
		if (this.#ctx.sessionManager.getSessionId() !== this.#sessionId) {
			void this.stop("session switched");
			this.#ctx.session.emitNotice("warning", "Collab ended: session switched", "collab");
			return;
		}
		for (const [peerId, peer] of this.#peers) {
			if (peer.recovery && !peer.recovery.completed) {
				if (peer.recovery.pendingLive.length < MAX_DEFERRED_LIVE_FRAMES) peer.recovery.pendingLive.push(frame);
				else logger.debug("collab: dropping live frame while snapshot is stalled", { type: frame.t, peerId });
				continue;
			}
			this.#socket.send(frame, peerId);
		}
	}

	#handleFrame(frame: CollabFrame, fromPeer: number): void {
		switch (frame.t) {
			case "hello":
				this.#handleHello(frame.name, frame.proto, frame.writeToken, fromPeer, frame);
				break;
			case "prompt":
				this.#handlePrompt(frame.text, frame.images, fromPeer);
				break;
			case "abort":
				this.#handleAbort(fromPeer);
				break;
			case "agent-cmd":
				this.#handleAgentCmd(frame.cmd, frame.agentId, frame.text, fromPeer);
				break;
			case "ui-response":
				this.#handleUiResponse(frame.reqId, frame.value, fromPeer);
				break;
			case "fetch-transcript":
				void this.#handleFetchTranscript(frame.reqId, frame.agentId, frame.fromByte, fromPeer);
				break;
			case "snapshot-ack":
				this.#handleSnapshotAck(frame, fromPeer);
				break;
			case "snapshot-page-request":
				this.#handleSnapshotPageRequest(frame, fromPeer);
				break;
			case "snapshot-page-ack":
				break;
			default:
				logger.debug("collab host ignoring unexpected frame", { type: frame.t, fromPeer });
		}
	}
	#verifyWriteToken(token: string | undefined): boolean {
		const expected = this.#writeToken;
		if (!expected || !token) return false;
		const bytes = Buffer.from(token, "base64url");
		return bytes.byteLength === expected.byteLength && timingSafeEqual(bytes, expected);
	}

	/** Reject a mutating frame from a read-only peer with a targeted error. */
	#rejectReadOnly(action: string, fromPeer: number): void {
		this.#socket?.send({ t: "error", message: `${action} is disabled on a read-only link` }, fromPeer);
	}
	#handleHello(
		name: string,
		proto: number,
		writeToken: string | undefined,
		fromPeer: number,
		hello?: SnapshotHello,
	): void {
		if (proto !== COLLAB_PROTO) {
			this.#socket?.send(
				{ t: "error", message: `protocol mismatch: host speaks v${COLLAB_PROTO}, guest sent v${proto}` },
				fromPeer,
			);
			return;
		}
		const cleanName = name.trim().slice(0, 64) || `guest-${fromPeer}`;
		const canWrite = this.#verifyWriteToken(writeToken);
		this.#peers.set(fromPeer, { name: cleanName, canWrite });
		if (hello?.snapshotRecovery) {
			this.#sendRecoverySnapshot(fromPeer, hello.resumeId ?? crypto.randomUUID(), hello);
			return;
		}

		// Snapshot and send synchronously: no awaits between snapshot, welcome,
		// and chunk sends, so subsequent broadcast frames (entry/event/state/bus)
		// queue behind the snapshot on the same socket and the guest can't
		// observe a gap between the snapshot fragment and live traffic.
		const snapshot = this.#ctx.sessionManager.snapshotForReplication();
		if (JSON.stringify(snapshot).length > WELCOME_IMAGE_STRIP_THRESHOLD) {
			let stripped = 0;
			for (const entry of snapshot.entries) {
				if (entry.type === "message") stripped += stripImagesFromMessage(entry.message);
			}
			logger.info("collab welcome exceeded size threshold; stripped images", { stripped });
		}
		const entries = snapshot.entries.filter(isWireSessionEntry);
		const socket = this.#socket;
		if (!socket) return;
		socket.send(
			{
				t: "welcome",
				proto: COLLAB_PROTO,
				header: snapshot.header,
				state: this.#buildState(),
				agents: this.#snapshotAgents(),
				entryCount: entries.length,
				readOnly: canWrite ? undefined : true,
			},
			fromPeer,
		);
		this.#sendSnapshotChunks(entries, fromPeer);
		if (canWrite) {
			for (const pending of this.#pendingUi.values()) {
				socket.send({ t: "ui-request", request: pending.request }, fromPeer);
			}
		}
		this.#ctx.session.emitNotice(
			"info",
			`${cleanName} joined the collab session${canWrite ? "" : " (read-only)"}`,
			"collab",
		);
		this.#updateStatusSegment();
		this.#scheduleStateBroadcast();
	}

	/**
	 * Slice {@link entries} into byte-bounded `snapshot-chunk` frames targeted
	 * at {@link fromPeer}. Each entry is first run through
	 * {@link shrinkForReplication} so a single oversized tool-result entry
	 * cannot ship as an oversized chunk that trips the relay's per-frame
	 * `maxPayloadLength` (issue #3739). Every batch carries at least one
	 * entry, and the last batch is tagged `final: true` so the guest can
	 * finalize the replica. An empty snapshot still emits one `final` chunk
	 * so the guest never blocks on a missing terminator.
	 */
	#sendSnapshotChunks(entries: (StoredSessionEntry & WireSessionEntry)[], fromPeer: number): void {
		const socket = this.#socket;
		if (!socket) return;
		if (entries.length === 0) {
			socket.send({ t: "snapshot-chunk", entries: [], final: true }, fromPeer);
			return;
		}
		let i = 0;
		while (i < entries.length) {
			const batch: (StoredSessionEntry & WireSessionEntry)[] = [];
			let batchBytes = 0;
			while (i < entries.length) {
				const entry = entries[i];
				if (!entry) break;
				const shrunk = shrinkForReplication(entry);
				const entryBytes = JSON.stringify(shrunk).length;
				if (batch.length > 0 && batchBytes + entryBytes > SNAPSHOT_CHUNK_BYTES) break;
				batch.push(shrunk);
				batchBytes += entryBytes;
				i++;
			}
			socket.send({ t: "snapshot-chunk", entries: batch, final: i >= entries.length }, fromPeer);
		}
	}

	#sendRecoverySnapshot(peerId: number, resumeId: string, hello: SnapshotHello): void {
		const socket = this.#socket;
		if (!socket) return;
		const current = this.#snapshotTransfers.get(resumeId);
		const canResume =
			current !== undefined &&
			current.peerId === null &&
			hello.snapshotId === current.snapshotId &&
			!current.completed;
		let transfer = current;
		if (!canResume) {
			const snapshot = this.#ctx.sessionManager.snapshotForReplication();
			if (JSON.stringify(snapshot).length > WELCOME_IMAGE_STRIP_THRESHOLD) {
				for (const entry of snapshot.entries) {
					if (entry.type === "message") stripImagesFromMessage(entry.message);
				}
			}
			const entries = snapshot.entries.filter(isWireSessionEntry).map(entry => shrinkForReplication(entry));
			const initialEntries = entries.slice(0, SNAPSHOT_INITIAL_HISTORY_ENTRIES);
			const payloads = splitSnapshotPayload(serializeSnapshotEntries(initialEntries));
			const snapshotId = crypto.randomUUID();
			transfer = {
				resumeId,
				snapshotId,
				sender: new SnapshotSender(snapshotId, payloads),
				entries,
				initialEntryCount: initialEntries.length,
				nextHistoryCursor: entries.length > initialEntries.length ? String(initialEntries.length) : undefined,
				peerId,
				pendingLive: [],
				ackTimer: null,
				retentionTimer: null,
				lastUsedAt: Date.now(),
				completed: false,
			};
			this.#snapshotTransfers.set(resumeId, transfer);
			this.#trimSnapshotTransfers();
		} else if (transfer) {
			transfer.peerId = peerId;
			transfer.lastUsedAt = Date.now();
			if (transfer.retentionTimer !== null) {
				clearTimeout(transfer.retentionTimer);
				transfer.retentionTimer = null;
			}
		}
		if (!transfer) return;
		const peer = this.#peers.get(peerId);
		if (!peer || !transfer) return;
		peer.recovery = transfer;
		const initialAck: SnapshotAckFrame = {
			t: "snapshot-ack",
			snapshotId: transfer.snapshotId,
			contiguousSeq: hello.snapshotId === transfer.snapshotId ? (hello.contiguousSeq ?? -1) : -1,
			missing: hello.snapshotId === transfer.snapshotId ? hello.missing : undefined,
		};
		socket.send(
			{
				t: "welcome",
				proto: COLLAB_PROTO,
				header: this.#ctx.sessionManager.snapshotForReplication().header,
				state: this.#buildState(),
				agents: this.#snapshotAgents(),
				entryCount: transfer.initialEntryCount,
				readOnly: peer.canWrite ? undefined : true,
			},
			peerId,
		);
		socket.send(
			{
				t: "snapshot-begin",
				snapshotId: transfer.snapshotId,
				total: transfer.sender.total,
				entryCount: transfer.initialEntryCount,
				firstHistoryCursor: transfer.nextHistoryCursor,
			},
			peerId,
		);
		const result = transfer.sender.acknowledge(initialAck);
		if (result.exhausted) {
			this.#failSnapshotTransfer(transfer, "snapshot transfer retry exhausted", peerId);
			return;
		}
		this.#sendRecoveryChunks(transfer, result.chunks);
		if (result.complete) this.#finishSnapshotTransfer(transfer, peerId);
		else this.#armSnapshotAckTimer(transfer);
		if (peer.canWrite) {
			for (const pending of this.#pendingUi.values())
				socket.send({ t: "ui-request", request: pending.request }, peerId);
		}
		this.#ctx.session.emitNotice(
			"info",
			`${peer.name} joined the collab session${peer.canWrite ? "" : " (read-only)"}`,
			"collab",
		);
		this.#updateStatusSegment();
		this.#scheduleStateBroadcast();
	}

	#sendRecoveryChunks(transfer: SnapshotTransfer, chunks: readonly SnapshotChunkFrame[]): void {
		if (!this.#socket || transfer.peerId === null) return;
		for (const chunk of chunks) this.#socket.send(chunk, transfer.peerId);
	}

	#armSnapshotAckTimer(transfer: SnapshotTransfer): void {
		if (transfer.ackTimer !== null) clearTimeout(transfer.ackTimer);
		if (transfer.peerId === null || transfer.completed) {
			transfer.ackTimer = null;
			return;
		}
		transfer.ackTimer = setTimeout(() => {
			transfer.ackTimer = null;
			if (this.#stopped || transfer.peerId === null || transfer.completed) return;
			const result = transfer.sender.onTimeout();
			if (result.exhausted) {
				this.#failSnapshotTransfer(transfer, "snapshot transfer retry exhausted", transfer.peerId);
				return;
			}
			this.#sendRecoveryChunks(transfer, result.chunks);
			if (result.complete) this.#finishSnapshotTransfer(transfer, transfer.peerId);
			else this.#armSnapshotAckTimer(transfer);
		}, SNAPSHOT_ACK_TIMEOUT_MS);
	}

	#finishSnapshotTransfer(transfer: SnapshotTransfer, peerId: number): void {
		if (transfer.completed) return;
		transfer.completed = true;
		if (transfer.ackTimer !== null) {
			clearTimeout(transfer.ackTimer);
			transfer.ackTimer = null;
		}
		const peer = this.#peers.get(peerId);
		if (peer?.recovery === transfer) peer.recovery = undefined;
		if (this.#socket) this.#socket.send({ t: "snapshot-end", snapshotId: transfer.snapshotId }, peerId);
		if (this.#socket) {
			for (const frame of transfer.pendingLive.splice(0)) this.#socket.send(frame, peerId);
		}
		this.#retainSnapshotTransfer(transfer);
	}

	#failSnapshotTransfer(transfer: SnapshotTransfer, reason: string, peerId: number): void {
		if (transfer.ackTimer !== null) clearTimeout(transfer.ackTimer);
		if (transfer.retentionTimer !== null) clearTimeout(transfer.retentionTimer);
		transfer.ackTimer = null;
		transfer.retentionTimer = null;
		const peer = this.#peers.get(peerId);
		if (peer?.recovery === transfer) peer.recovery = undefined;
		if (this.#socket) this.#socket.send({ t: "error", message: reason }, peerId);
		if (this.#snapshotTransfers.get(transfer.resumeId) === transfer)
			this.#snapshotTransfers.delete(transfer.resumeId);
		transfer.pendingLive.length = 0;
	}

	#retainSnapshotTransfer(transfer: SnapshotTransfer): void {
		transfer.lastUsedAt = Date.now();
		if (transfer.retentionTimer !== null) clearTimeout(transfer.retentionTimer);
		transfer.retentionTimer = setTimeout(() => {
			if (this.#snapshotTransfers.get(transfer.resumeId) !== transfer || transfer.peerId !== null) return;
			this.#snapshotTransfers.delete(transfer.resumeId);
		}, SNAPSHOT_RESUME_RETENTION_MS);
	}

	#trimSnapshotTransfers(): void {
		while (this.#snapshotTransfers.size > SNAPSHOT_MAX_RETAINED_TRANSFERS) {
			let oldest: SnapshotTransfer | undefined;
			for (const candidate of this.#snapshotTransfers.values()) {
				if (!oldest || candidate.lastUsedAt < oldest.lastUsedAt) oldest = candidate;
			}
			if (!oldest) return;
			if (oldest.ackTimer !== null) clearTimeout(oldest.ackTimer);
			if (oldest.retentionTimer !== null) clearTimeout(oldest.retentionTimer);
			this.#snapshotTransfers.delete(oldest.resumeId);
		}
	}

	#handleSnapshotAck(frame: SnapshotAckFrame, fromPeer: number): void {
		const transfer = this.#peers.get(fromPeer)?.recovery;
		if (!transfer || transfer.snapshotId !== frame.snapshotId) return;
		const result = transfer.sender.acknowledge(frame);
		if (result.exhausted) {
			this.#failSnapshotTransfer(transfer, "snapshot transfer retry exhausted", fromPeer);
			return;
		}
		this.#sendRecoveryChunks(transfer, result.chunks);
		if (result.complete) this.#finishSnapshotTransfer(transfer, fromPeer);
		else this.#armSnapshotAckTimer(transfer);
	}

	#handleSnapshotPageRequest(frame: SnapshotPageRequestFrame, fromPeer: number): void {
		const peer = this.#peers.get(fromPeer);
		const transfer =
			peer?.recovery ??
			[...this.#snapshotTransfers.values()].find(candidate => candidate.snapshotId === frame.snapshotId);
		if (!peer || !transfer || transfer.snapshotId !== frame.snapshotId || !this.#socket) return;
		const start = Number(frame.cursor);
		if (!Number.isSafeInteger(start) || start < 0 || start >= transfer.entries.length) return;
		let end = Math.min(start + SNAPSHOT_HISTORY_PAGE_ENTRIES, transfer.entries.length);
		while (
			end > start &&
			serializeSnapshotEntries(transfer.entries.slice(start, end)).byteLength > SNAPSHOT_CHUNK_PAYLOAD_BYTES
		)
			end--;
		if (end === start) end = Math.min(start + 1, transfer.entries.length);
		const payload = serializeSnapshotEntries(transfer.entries.slice(start, end));
		this.#socket.send(
			{
				t: "snapshot-page",
				snapshotId: transfer.snapshotId,
				cursor: frame.cursor,
				nextCursor: end < transfer.entries.length ? String(end) : undefined,
				payload: encodeSnapshotPayload(payload),
				checksum: checksumSnapshotPayload(payload),
			},
			fromPeer,
		);
	}

	#handleUiResponse(reqId: number, value: CollabUiResponseValue, fromPeer: number): void {
		const peer = this.#peers.get(fromPeer);
		if (!peer?.canWrite) {
			this.#rejectReadOnly("responding to ask", fromPeer);
			return;
		}
		this.#pendingUi.get(reqId)?.settle({ kind: "answered", value });
	}

	#handlePrompt(text: string, images: ImageContent[] | undefined, fromPeer: number): void {
		const peer = this.#peers.get(fromPeer);
		if (!peer?.canWrite) {
			this.#rejectReadOnly("prompting", fromPeer);
			return;
		}
		const name = peer.name;
		const content: string | (TextContent | ImageContent)[] =
			images && images.length > 0 ? [{ type: "text", text }, ...images] : text;
		const details: CollabPromptDetails = { from: name };
		if (this.#ctx.session.isStreaming) {
			this.#ctx.updatePendingMessagesDisplay();
			this.#ctx.ui.requestRender();
			this.#scheduleStateBroadcast();
		}
		this.#ctx.session
			.promptCustomMessage(
				{
					customType: COLLAB_PROMPT_MESSAGE_TYPE,
					content,
					display: true,
					details,
					attribution: "user",
				},
				{ streamingBehavior: "steer", queueChipText: text },
			)
			.catch(err => {
				logger.warn("collab guest prompt failed", { error: String(err) });
				this.#socket?.send({ t: "error", message: `prompt failed: ${String(err)}` }, fromPeer);
			});
	}

	#handleAbort(fromPeer: number): void {
		const peer = this.#peers.get(fromPeer);
		if (!peer?.canWrite) {
			this.#rejectReadOnly("interrupting", fromPeer);
			return;
		}
		const name = peer.name;
		void this.#ctx.session
			.abort({ reason: USER_INTERRUPT_LABEL })
			.then(() => this.#ctx.session.emitNotice("info", `${name} interrupted`, "collab"))
			.catch(err => logger.warn("collab guest abort failed", { error: String(err) }));
	}

	#handlePeerLeft(peer: number): void {
		const current = this.#peers.get(peer);
		const name = current?.name;
		if (current?.recovery) {
			current.recovery.peerId = null;
			if (current.recovery.ackTimer !== null) {
				clearTimeout(current.recovery.ackTimer);
				current.recovery.ackTimer = null;
			}
			this.#retainSnapshotTransfer(current.recovery);
		}
		this.#peers.delete(peer);
		if (name) this.#ctx.session.emitNotice("info", `${name} left the collab session`, "collab");
		this.#updateStatusSegment();
		this.#scheduleStateBroadcast();
	}

	#buildState(): CollabSessionState {
		const session = this.#ctx.session;
		// Context numbers come from the status line's memoized breakdown so guests
		// render exactly the same anchored, provider-real count the host's own
		// status line shows.
		const breakdown = this.#ctx.statusLine.getCachedContextBreakdown();
		const tokens = breakdown.usedTokens ?? 0;
		return {
			isStreaming: session.isStreaming,
			isAborting: session.isAborting,
			queuedMessageCount: session.queuedMessageCount,
			sessionName: session.sessionName,
			cwd: this.#ctx.sessionManager.getCwd(),
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			contextUsage: {
				tokens,
				contextWindow: breakdown.contextWindow,
				percent: breakdown.contextWindow > 0 ? (tokens / breakdown.contextWindow) * 100 : 0,
			},
			participants: this.participants,
		};
	}

	#onEventForState(event: AgentSessionEvent): void {
		if (!STATE_TRIGGER_EVENTS[event.type]) return;
		this.#scheduleStateBroadcast();
		if (event.type === "agent_start" && !this.#streamingInterval) {
			this.#streamingInterval = setInterval(() => this.#scheduleStateBroadcast(), STREAMING_STATE_INTERVAL_MS);
		} else if (event.type === "agent_end" && this.#streamingInterval) {
			clearInterval(this.#streamingInterval);
			this.#streamingInterval = null;
		}
	}

	#snapshotAgents(): AgentSnapshot[] {
		return (
			AgentRegistry.global()
				.list()
				// Advisor transcripts are local observability only; never mirror them to
				// guests (the wire AgentSnapshot kind has no `advisor`, and guests must not
				// be able to chat/kill/revive them).
				.filter((ref): ref is AgentRef & { kind: "main" | "sub" } => ref.kind !== "advisor")
				.map(ref => ({
					id: ref.id,
					displayName: ref.displayName,
					kind: ref.kind,
					parentId: ref.parentId,
					status: ref.status,
					hasSessionFile: !!ref.sessionFile,
					createdAt: ref.createdAt,
					lastActivity: ref.lastActivity,
				}))
		);
	}

	#scheduleAgentsBroadcast(): void {
		if (this.#stopped || this.#agentsDebounce) return;
		this.#agentsDebounce = setTimeout(() => {
			this.#agentsDebounce = null;
			this.#broadcast({ t: "agents", agents: this.#snapshotAgents() });
		}, AGENTS_DEBOUNCE_MS);
	}

	#handleAgentCmd(cmd: "chat" | "kill" | "revive", agentId: string, text: string | undefined, fromPeer: number): void {
		if (!this.#peers.get(fromPeer)?.canWrite) {
			this.#rejectReadOnly("agent control", fromPeer);
			return;
		}
		// Advisor refs are excluded from snapshots, but reject control by id defensively:
		// a stale/malicious client must never chat/kill/revive a read-only advisor transcript.
		if (AgentRegistry.global().get(agentId)?.kind === "advisor") {
			this.#socket?.send({ t: "error", message: `agent ${agentId}: advisor transcripts are read-only` }, fromPeer);
			return;
		}
		const fail = (err: unknown) => {
			logger.warn("collab agent-cmd failed", { cmd, agentId, error: String(err) });
			this.#socket?.send({ t: "error", message: `agent ${agentId}: ${String(err)}` }, fromPeer);
		};
		switch (cmd) {
			case "chat": {
				const trimmed = text?.trim();
				if (!trimmed) {
					this.#socket?.send({ t: "error", message: `agent ${agentId}: empty chat message` }, fromPeer);
					return;
				}
				// Mirrors the hub's #submitChatMessage: revive if parked, steer if mid-turn.
				AgentLifecycleManager.global()
					.ensureLive(agentId)
					.then(session => session.prompt(trimmed, { streamingBehavior: "steer" }))
					.catch(fail);
				break;
			}
			case "kill": {
				const kill = async () => {
					const ref = AgentRegistry.global().get(agentId);
					if (!ref) return;
					if (ref.status === "running" && ref.session) {
						await ref.session.abort({ reason: USER_INTERRUPT_LABEL });
					}
					await AgentLifecycleManager.global().release(agentId, ref, { tombstone: true });
				};
				kill().catch(fail);
				break;
			}
			case "revive":
				AgentLifecycleManager.global().ensureLive(agentId).catch(fail);
				break;
		}
	}

	/** Incremental transcript read mirroring the hub's readFileIncremental contract. */
	async #handleFetchTranscript(reqId: number, agentId: string, fromByte: number, fromPeer: number): Promise<void> {
		const reply = (text: string, newSize: number, error?: string) =>
			this.#socket?.send({ t: "transcript", reqId, text, newSize, error }, fromPeer);
		const file = AgentRegistry.global().get(agentId)?.sessionFile;
		if (!file) {
			reply("", fromByte, "no transcript available");
			return;
		}
		try {
			const stat = await fs.stat(file);
			if (stat.size <= fromByte) {
				reply("", stat.size);
				return;
			}
			const want = Math.min(stat.size - fromByte, TRANSCRIPT_READ_CAP);
			const handle = await fs.open(file, "r");
			let bytesRead: number;
			const buf = Buffer.allocUnsafe(want);
			try {
				({ bytesRead } = await handle.read(buf, 0, want, fromByte));
			} finally {
				await handle.close();
			}
			let slice = buf.subarray(0, bytesRead);
			const reachedEof = fromByte + bytesRead >= stat.size;
			if (!reachedEof) {
				// Trim to the last complete JSONL line so no line or UTF-8 char is split.
				const lastNewline = slice.lastIndexOf(0x0a);
				if (lastNewline < 0) {
					reply("", fromByte, TRANSCRIPT_ENTRY_TOO_LARGE_ERROR);
					return;
				}
				slice = slice.subarray(0, lastNewline + 1);
			}
			reply(slice.toString("utf-8"), reachedEof ? stat.size : fromByte + slice.byteLength);
		} catch (err) {
			logger.debug("collab transcript read failed", { agentId, error: String(err) });
			reply("", fromByte, String(err));
		}
	}

	#scheduleStateBroadcast(): void {
		if (this.#stopped || this.#stateDebounce) return;
		this.#stateDebounce = setTimeout(() => {
			this.#stateDebounce = null;
			const state = this.#buildState();
			const json = JSON.stringify(state);
			if (json === this.#lastStateJson) return;
			this.#lastStateJson = json;
			this.#broadcast({ t: "state", state });
		}, STATE_DEBOUNCE_MS);
	}

	#updateStatusSegment(): void {
		this.#ctx.statusLine.setCollabStatus({ role: "host", participantCount: this.#peers.size + 1 });
		this.#ctx.statusLine.invalidate();
		this.#ctx.ui.requestRender();
	}
}
