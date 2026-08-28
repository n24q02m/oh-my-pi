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
import type { SessionHeader, SessionEntry as StoredSessionEntry } from "../session/session-entries";
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
	SNAPSHOT_MAX_ENTRY_COUNT,
	SNAPSHOT_MAX_RETAINED_TRANSFERS,
	SNAPSHOT_MAX_TRANSFER_BYTES,
	SNAPSHOT_PAGE_ACK_TIMEOUT_MS,
	SNAPSHOT_RESUME_RETENTION_MS,
	type SnapshotAckFrame,
	type SnapshotChunkFrame,
	type SnapshotHello,
	type SnapshotPageAckFrame,
	type SnapshotPageFrame,
	type SnapshotPageRequestFrame,
	SnapshotPageSender,
	SnapshotSender,
	serializeSnapshotEntries,
	splitSnapshotPayload,
} from "./protocol";
import { CollabSocket, MAX_ENCRYPTED_COLLAB_FRAME_BYTES } from "./relay-client";
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
/** Return UTF-8 byte length for the exact JSON representation sent to the relay. */
const snapshotEncoder = new TextEncoder();
function snapshotJsonBytes(value: unknown): number {
	return snapshotEncoder.encode(JSON.stringify(value)).byteLength;
}

function fitSnapshotMessageContent(
	base: { id: string; parentId: string | null; timestamp: string },
	message: Record<string, unknown>,
	content: string,
): StoredSessionEntry & WireSessionEntry {
	const markerEnd = content.lastIndexOf(" chars elided for collab session]");
	const markerStart = markerEnd >= 0 ? content.lastIndexOf("\n…[", markerEnd) : -1;
	const marker = markerStart >= 0 ? content.slice(markerStart) : "\n…[content elided for collab snapshot]";
	const source = markerStart >= 0 ? content.slice(0, markerStart) : content;
	const makeEntry = (fittedContent: string): StoredSessionEntry & WireSessionEntry =>
		({
			...base,
			type: "message",
			message: { ...message, content: fittedContent },
		} as StoredSessionEntry & WireSessionEntry);
	let low = 0;
	let high = source.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (snapshotJsonBytes(makeEntry(source.slice(0, middle) + marker)) <= SNAPSHOT_CHUNK_BYTES) low = middle;
		else high = middle - 1;
	}
	return makeEntry(source.slice(0, low) + marker);
}

function fitSnapshotEntry(entry: StoredSessionEntry & WireSessionEntry): StoredSessionEntry & WireSessionEntry {
	const candidate = shrinkForReplication(entry);
	if (snapshotJsonBytes(candidate) <= SNAPSHOT_CHUNK_BYTES) return candidate;
	const base = {
		id: candidate.id,
		parentId: candidate.parentId,
		timestamp: candidate.timestamp,
		type: candidate.type,
	};
	switch (candidate.type) {
		case "message": {
			const {
				content: messageContent,
				details: _details,
				providerMetadata: _providerMetadata,
				providerPayload: _providerPayload,
				errorMessage: _errorMessage,
				...message
			} = candidate.message as unknown as Record<string, unknown>;
			if (typeof messageContent === "string") return fitSnapshotMessageContent(base, message, messageContent);
			return {
				...base,
				type: "message",
				message: { ...message, content: [{ type: "text", text: "[content elided for collab snapshot]" }] },
			} as StoredSessionEntry & WireSessionEntry;
		}
		case "custom_message":
			return {
				...base,
				type: "custom_message",
				customType: candidate.customType,
				content: "[content elided for collab snapshot]",
				display: candidate.display,
			} as StoredSessionEntry & WireSessionEntry;
		case "compaction":
			return {
				...base,
				type: "compaction",
				summary: "[summary elided for collab snapshot]",
				firstKeptEntryId: candidate.firstKeptEntryId,
				tokensBefore: candidate.tokensBefore,
			} as StoredSessionEntry & WireSessionEntry;
		case "branch_summary":
			return {
				...base,
				type: "branch_summary",
				fromId: candidate.fromId,
				summary: "[summary elided for collab snapshot]",
			} as StoredSessionEntry & WireSessionEntry;
		case "model_change":
			return { ...base, type: "model_change", model: candidate.model, role: candidate.role } as StoredSessionEntry &
				WireSessionEntry;
		case "thinking_level_change":
			return {
				...base,
				type: "thinking_level_change",
				thinkingLevel: candidate.thinkingLevel,
			} as StoredSessionEntry & WireSessionEntry;
	}
}
const CONNECT_TIMEOUT_MS = 15_000;
/** Max bytes served per fetch-transcript reply (guest re-requests from `newSize`). */
export const TRANSCRIPT_READ_CAP = 4 * 1024 * 1024;
const TRANSCRIPT_ENTRY_TOO_LARGE_ERROR = `transcript entry exceeds transcript fetch cap (${TRANSCRIPT_READ_CAP} bytes)`;
/**
 * Byte cap for legacy and paginated entry batches. The relay client adds
 * authenticated encryption and enforces a 128 KiB encrypted envelope cap;
 * keeping each JSON payload below 64 KiB leaves room for UTF-8 and seal overhead.
 */
const SNAPSHOT_CHUNK_BYTES = SNAPSHOT_CHUNK_PAYLOAD_BYTES - 1024;
/**
 * Outcome of {@link CollabHost.requestGuestUi}. `answered` carries the guest's
 * response (an `undefined` value is a genuine guest cancel); `unavailable`
 * means the collab channel went away (teardown, relay drop) or the request was
 * aborted before any guest answered — callers MUST NOT treat it as a cancel.
 */
export type CollabGuestUiResult = { kind: "answered"; value: CollabUiResponseValue } | { kind: "unavailable" };

const MAX_DEFERRED_LIVE_FRAMES = 256;

const MAX_DEFERRED_LIVE_BYTES = 8 * 1024 * 1024;
/** Keep page retry state fair across peers; the global cap remains bounded. */
const MAX_PENDING_SNAPSHOT_PAGES_PER_PEER = 16;
const MAX_PENDING_SNAPSHOT_PAGES = 64;
const MAX_LIVE_SEQUENCE_HISTORY = 4096;
type SnapshotTransfer = {
	resumeId: string;
	sessionId: string;
	header: SessionHeader;
	recoveryEpoch: number;
	checksum: string;
	snapshotId: string;
	sender: SnapshotSender;
	entries: (StoredSessionEntry & WireSessionEntry)[];
	initialEntryCount: number;
	nextHistoryCursor?: string;
	peerId: number | null;
	pendingLive: CollabFrame[];
	ackTimer: Timer | null;
	pendingLiveBytes: number;
	needsResync: boolean;
	retentionTimer: Timer | null;
	lastUsedAt: number;
	completed: boolean;
	historyPending: boolean;
	completionAcked: boolean;
	completionAttempts: number;
};

type SnapshotPageTransfer = {
	peerId: number;
	recoveryEpoch: number;
	sender: SnapshotPageSender;
	nextCursor?: string;
	timer: Timer | null;
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
	#liveSeq = 0;
	#recoveryEpoch = 0;
	#snapshotTransfers = new Map<string, SnapshotTransfer>();
	#snapshotPages = new Map<string, SnapshotPageTransfer>();
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

	#sendFrame(frame: CollabFrame, targetPeer = 0): void {
		const socket = this.#socket;
		if (!socket) return;
		// Snapshot payload frames are fitted against the encrypted frame budget
		// and carry checksums, so shrinking their base64 payload would corrupt
		// the transfer. Live/control frames still use the replication shrinker.
		const outbound = frame.t === "snapshot-chunk" || frame.t === "snapshot-page" ? frame : shrinkForReplication(frame);
		socket.send(outbound, targetPeer);
	}

	#withLiveSequence(frame: CollabFrame): CollabFrame {
		if (frame.t !== "entry" && frame.t !== "event" && frame.t !== "bus") return frame;
		this.#liveSeq = this.#liveSeq >= Number.MAX_SAFE_INTEGER ? 1 : this.#liveSeq + 1;
		return { ...frame, liveSeq: this.#liveSeq };
	}

	#sendWritablePeers(frame: CollabFrame): void {
		for (const [peerId, peer] of this.#peers) {
			if (peer.canWrite) this.#sendFrame(frame, peerId);
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
		for (const page of this.#snapshotPages.values()) if (page.timer !== null) clearTimeout(page.timer);
		this.#snapshotPages.clear();
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
	#retireSnapshotTransfer(transfer: SnapshotTransfer, peerId: number): void {
		if (transfer.ackTimer !== null) clearTimeout(transfer.ackTimer);
		if (transfer.retentionTimer !== null) clearTimeout(transfer.retentionTimer);
		transfer.ackTimer = null;
		transfer.retentionTimer = null;
		const pagePrefix = `${String(peerId)}:${transfer.snapshotId}:`;
		for (const [key, page] of this.#snapshotPages) {
			if (page.peerId !== peerId || !key.startsWith(pagePrefix)) continue;
			if (page.timer !== null) clearTimeout(page.timer);
			this.#snapshotPages.delete(key);
		}
		transfer.pendingLive.length = 0;
		transfer.pendingLiveBytes = 0;
		transfer.peerId = null;
		transfer.completed = true;
		transfer.historyPending = false;
		transfer.needsResync = true;
		if (this.#snapshotTransfers.get(transfer.resumeId) === transfer)
			this.#snapshotTransfers.delete(transfer.resumeId);
	}

	#restartSnapshotTransfer(transfer: SnapshotTransfer, peerId: number, frame?: CollabFrame): void {
		const peer = this.#peers.get(peerId);
		if (!peer || peer.recovery !== transfer || transfer.peerId !== peerId || !this.#socket) {
			transfer.needsResync = true;
			return;
		}
		peer.recovery = undefined;
		this.#retireSnapshotTransfer(transfer, peerId);
		const replacement = this.#sendRecoverySnapshot(peerId, transfer.resumeId, {
			t: "hello",
			proto: COLLAB_PROTO,
			name: peer.name,
			snapshotRecovery: true,
			resumeId: transfer.resumeId,
		});
		if (!replacement || replacement === transfer || !frame) return;
		if (frame.t === "entry") {
			if (!replacement.entries.some(entry => entry.id === frame.entry.id))
				this.#deferSnapshotLive(replacement, frame);
		} else if (frame.t !== "state" && frame.t !== "agents") {
			this.#deferSnapshotLive(replacement, frame);
		}
	}

	#deferSnapshotLive(transfer: SnapshotTransfer, frame: CollabFrame, peerId?: number): void {
		if ((transfer.completed && !transfer.historyPending) || transfer.needsResync) return;
		const bytes = snapshotJsonBytes(frame);
		if (bytes > MAX_DEFERRED_LIVE_BYTES) {
			// A single pathological frame must not recursively trigger replacement.
			// The replacement snapshot contains the authoritative entry when possible;
			// event/bus data is intentionally dropped rather than overflowing the stack.
			logger.warn("collab: dropping oversized live frame and forcing snapshot resync", {
				type: frame.t,
				bytes,
			});
			if (peerId !== undefined) this.#restartSnapshotTransfer(transfer, peerId);
			else {
				transfer.needsResync = true;
				transfer.pendingLive.length = 0;
				transfer.pendingLiveBytes = 0;
			}
			return;
		}
		if (
			transfer.pendingLive.length >= MAX_DEFERRED_LIVE_FRAMES ||
			transfer.pendingLiveBytes + bytes > MAX_DEFERRED_LIVE_BYTES
		) {
			logger.debug("collab: snapshot live queue exceeded bound; replacing active snapshot");
			if (peerId !== undefined) this.#restartSnapshotTransfer(transfer, peerId, frame);
			else {
				transfer.needsResync = true;
				transfer.pendingLive.length = 0;
				transfer.pendingLiveBytes = 0;
			}
			return;
		}
		transfer.pendingLive.push(frame);
		transfer.pendingLiveBytes += bytes;
	}

	#broadcast(frame: CollabFrame): void {
		if (this.#stopped || !this.#socket) return;
		if (this.#ctx.sessionManager.getSessionId() !== this.#sessionId) {
			void this.stop("session switched");
			this.#ctx.session.emitNotice("warning", "Collab ended: session switched", "collab");
			return;
		}
		const broadcastFrame = this.#withLiveSequence(frame);
		const deferred = new Set<SnapshotTransfer>();
		for (const [peerId, peer] of this.#peers) {
			if (peer.recovery && (!peer.recovery.completed || peer.recovery.historyPending)) {
				this.#deferSnapshotLive(peer.recovery, broadcastFrame, peerId);
				deferred.add(peer.recovery);
				continue;
			}
			this.#sendFrame(broadcastFrame, peerId);
		}
		for (const transfer of this.#snapshotTransfers.values()) {
			if (transfer.peerId === null && (!transfer.completed || transfer.historyPending) && !deferred.has(transfer))
				this.#deferSnapshotLive(transfer, broadcastFrame);
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
				this.#handleSnapshotPageAck(frame, fromPeer);
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
			this.#sendFrame(
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
		const entries = snapshot.entries.filter(isWireSessionEntry).map(entry => fitSnapshotEntry(entry));
		const socket = this.#socket;
		if (!socket) return;
		if (entries.length > SNAPSHOT_MAX_ENTRY_COUNT) {
			this.#sendFrame({ t: "error", message: "collab snapshot exceeds the bounded history entry limit" }, fromPeer);
			return;
		}
		const historyBytes = snapshotJsonBytes(entries);
		if (historyBytes > SNAPSHOT_MAX_TRANSFER_BYTES) {
			this.#sendFrame({ t: "error", message: "collab snapshot exceeds the bounded legacy history byte limit" }, fromPeer);
			return;
		}
		this.#sendFrame(
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
				this.#sendFrame({ t: "ui-request", request: pending.request }, fromPeer);
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
	 * Slice entries into UTF-8 byte-bounded legacy frames. The legacy shape is
	 * retained for old guests, while recovery-capable guests use sequenced bytes.
	 */
	#sendSnapshotChunks(entries: (StoredSessionEntry & WireSessionEntry)[], fromPeer: number): void {
		const socket = this.#socket;
		if (!socket) return;
		if (entries.length === 0) {
			this.#sendFrame({ t: "snapshot-chunk", entries: [], final: true }, fromPeer);
			return;
		}
		let i = 0;
		while (i < entries.length) {
			const batch: (StoredSessionEntry & WireSessionEntry)[] = [];
			while (i < entries.length) {
				const entry = entries[i];
				if (!entry) break;
				const shrunk = fitSnapshotEntry(entry);
				const candidate = [...batch, shrunk];
				const candidateBytes =
					snapshotJsonBytes({ t: "snapshot-chunk", entries: candidate, final: false }) + 32 + 4;
				if (batch.length > 0 && candidateBytes > MAX_ENCRYPTED_COLLAB_FRAME_BYTES) break;
				batch.push(shrunk);
				i++;
			}
			this.#sendFrame({ t: "snapshot-chunk", entries: batch, final: i >= entries.length }, fromPeer);
		}
	}

	#sendRecoveryHeader(transfer: SnapshotTransfer, peerId: number, canWrite: boolean): void {
		this.#sendFrame(
			{
				t: "welcome",
				proto: COLLAB_PROTO,
				header: transfer.header,
				state: this.#buildState(),
				agents: this.#snapshotAgents(),
				entryCount: transfer.initialEntryCount,
				snapshotId: transfer.snapshotId,
				recoveryEpoch: transfer.recoveryEpoch,
				resumeId: transfer.resumeId,
				readOnly: canWrite ? undefined : true,
			},
			peerId,
		);
		this.#sendFrame(
			{
				t: "snapshot-begin",
				snapshotId: transfer.snapshotId,
				recoveryEpoch: transfer.recoveryEpoch,
				resumeId: transfer.resumeId,
				total: transfer.sender.total,
				entryCount: transfer.initialEntryCount,
				firstHistoryCursor: transfer.nextHistoryCursor,
			},
			peerId,
		);
	}
	#sendRecoverySnapshot(peerId: number, resumeId: string, hello: SnapshotHello): SnapshotTransfer | undefined {
		if (!this.#socket) return;
		const currentSnapshot = this.#ctx.sessionManager.snapshotForReplication();
		const current = this.#snapshotTransfers.get(resumeId);
		const canResume =
			current !== undefined &&
			current.peerId === null &&
			hello.snapshotId === current.snapshotId &&
			hello.recoveryEpoch === current.recoveryEpoch &&
			current.sessionId === currentSnapshot.header.id &&
			!current.completed &&
			!current.needsResync;
		if (current && !canResume && current.peerId === null) {
			if (current.ackTimer !== null) clearTimeout(current.ackTimer);
			if (current.retentionTimer !== null) clearTimeout(current.retentionTimer);
			this.#snapshotTransfers.delete(current.resumeId);
		}
		let transfer: SnapshotTransfer | undefined = current;
		if (!canResume) {
			const snapshot = currentSnapshot;
			if (JSON.stringify(snapshot).length > WELCOME_IMAGE_STRIP_THRESHOLD) {
				for (const entry of snapshot.entries) {
					if (entry.type === "message") stripImagesFromMessage(entry.message);
				}
			}
			const entries = snapshot.entries.filter(isWireSessionEntry).map(entry => fitSnapshotEntry(entry));
			const historyBytes = snapshotJsonBytes(entries);
			if (entries.length > SNAPSHOT_MAX_ENTRY_COUNT || historyBytes > SNAPSHOT_MAX_TRANSFER_BYTES) {
				this.#sendFrame({ t: "error", message: "collab snapshot exceeds the bounded recovery history limit" }, peerId);
				return;
			}
			const initialEntries = entries.slice(0, SNAPSHOT_INITIAL_HISTORY_ENTRIES);
			const initialPayload = serializeSnapshotEntries(initialEntries);
			const payloads = splitSnapshotPayload(initialPayload);
			this.#recoveryEpoch = this.#recoveryEpoch >= Number.MAX_SAFE_INTEGER ? 1 : this.#recoveryEpoch + 1;
			const snapshotId = crypto.randomUUID();
			transfer = {
				resumeId,
				sessionId: snapshot.header.id,
				header: snapshot.header,
				recoveryEpoch: this.#recoveryEpoch,
				checksum: checksumSnapshotPayload(initialPayload),
				snapshotId,
				sender: new SnapshotSender(snapshotId, payloads),
				entries,
				initialEntryCount: initialEntries.length,
				nextHistoryCursor: entries.length > initialEntries.length ? String(initialEntries.length) : undefined,
				peerId,
				pendingLive: [],
				pendingLiveBytes: 0,
				needsResync: false,
				ackTimer: null,
				retentionTimer: null,
				lastUsedAt: Date.now(),
				completed: false,
				historyPending: entries.length > initialEntries.length,
				completionAcked: false,
				completionAttempts: 0,
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
		if (!peer) return;
		peer.recovery = transfer;
		const sameTransfer = hello.snapshotId === transfer.snapshotId && hello.recoveryEpoch === transfer.recoveryEpoch;
		const initialAck: SnapshotAckFrame = {
			t: "snapshot-ack",
			snapshotId: transfer.snapshotId,
			recoveryEpoch: transfer.recoveryEpoch,
			contiguousSeq: sameTransfer ? (hello.contiguousSeq ?? -1) : -1,
			missing: sameTransfer ? hello.missing : undefined,
		};
		this.#sendRecoveryHeader(transfer, peerId, peer.canWrite);
		const result = transfer.sender.acknowledge(initialAck, canResume);
		if (result.exhausted) {
			this.#failSnapshotTransfer(transfer, "snapshot transfer retry exhausted", peerId);
			return;
		}
		this.#sendRecoveryChunks(transfer, result.chunks);
		if (result.complete) this.#finishSnapshotTransfer(transfer, peerId);
		else this.#armSnapshotAckTimer(transfer);
		if (peer.canWrite) {
			for (const pending of this.#pendingUi.values()) this.#sendFrame({ t: "ui-request", request: pending.request }, peerId);
		}
		this.#ctx.session.emitNotice(
			"info",
			`${peer.name} joined the collab session${peer.canWrite ? "" : " (read-only)"}`,
			"collab",
		);
		this.#updateStatusSegment();
		this.#scheduleStateBroadcast();
		return transfer;
	}

	#sendRecoveryChunks(transfer: SnapshotTransfer, chunks: readonly SnapshotChunkFrame[]): void {
		if (!this.#socket || transfer.peerId === null) return;
		for (const chunk of chunks)
			this.#sendFrame({ ...chunk, recoveryEpoch: transfer.recoveryEpoch }, transfer.peerId);
	}
	#sendRecoveryEnd(transfer: SnapshotTransfer, peerId: number): void {
		this.#sendFrame(
			{
				t: "snapshot-end",
				snapshotId: transfer.snapshotId,
				recoveryEpoch: transfer.recoveryEpoch,
				checksum: transfer.checksum,
			},
			peerId,
		);
	}

	#armSnapshotAckTimer(transfer: SnapshotTransfer): void {
		if (transfer.ackTimer !== null) clearTimeout(transfer.ackTimer);
		if (transfer.peerId === null) {
			transfer.ackTimer = null;
			return;
		}
		if (transfer.completed) {
			if (transfer.completionAcked) {
				transfer.ackTimer = null;
				return;
			}
			transfer.ackTimer = setTimeout(() => {
				transfer.ackTimer = null;
				if (this.#stopped || transfer.peerId === null || !transfer.completed || transfer.completionAcked) return;
				if (transfer.completionAttempts >= SNAPSHOT_MAX_RETRIES) {
					this.#failSnapshotTransfer(transfer, "snapshot completion retry exhausted", transfer.peerId);
					return;
				}
				transfer.completionAttempts++;
				this.#sendRecoveryEnd(transfer, transfer.peerId);
				this.#armSnapshotAckTimer(transfer);
			}, SNAPSHOT_ACK_TIMEOUT_MS);
			return;
		}
		const peer = this.#peers.get(transfer.peerId);
		if (!peer) {
			transfer.ackTimer = null;
			return;
		}
		transfer.ackTimer = setTimeout(() => {
			transfer.ackTimer = null;
			if (this.#stopped || transfer.peerId === null || transfer.completed) return;
			const currentPeer = this.#peers.get(transfer.peerId);
			if (!currentPeer || currentPeer.recovery !== transfer) return;
			const result = transfer.sender.onTimeout();
			if (result.exhausted) {
				this.#failSnapshotTransfer(transfer, "snapshot transfer retry exhausted", transfer.peerId);
				return;
			}
			this.#sendRecoveryHeader(transfer, transfer.peerId, currentPeer.canWrite);
			this.#sendRecoveryChunks(transfer, result.chunks);
			if (result.complete) this.#finishSnapshotTransfer(transfer, transfer.peerId);
			else this.#armSnapshotAckTimer(transfer);
		}, SNAPSHOT_ACK_TIMEOUT_MS);
	}

	#finishSnapshotTransfer(transfer: SnapshotTransfer, peerId: number): void {
		if (transfer.completed) return;
		transfer.completed = true;
		transfer.completionAttempts = 0;
		if (transfer.ackTimer !== null) {
			clearTimeout(transfer.ackTimer);
			transfer.ackTimer = null;
		}
		this.#sendRecoveryEnd(transfer, peerId);
		transfer.historyPending = transfer.nextHistoryCursor !== undefined;
		this.#maybeReleaseSnapshotLive(transfer, peerId);
		if (!transfer.completionAcked && transfer.peerId !== null) this.#armSnapshotAckTimer(transfer);
	}

	#acceptSnapshotCompletion(transfer: SnapshotTransfer, frame: SnapshotAckFrame, peerId: number): void {
		if (
			!transfer.completed ||
			frame.recoveryEpoch !== transfer.recoveryEpoch ||
			frame.complete !== true ||
			frame.digest !== transfer.checksum
		)
			return;
		transfer.completionAcked = true;
		if (transfer.ackTimer !== null) {
			clearTimeout(transfer.ackTimer);
			transfer.ackTimer = null;
		}
		this.#maybeReleaseSnapshotLive(transfer, peerId);
	}

	#maybeReleaseSnapshotLive(transfer: SnapshotTransfer, peerId: number): void {
		if (!transfer.completionAcked || transfer.historyPending) return;
		this.#releaseSnapshotLive(transfer, peerId);
	}

	#releaseSnapshotLive(transfer: SnapshotTransfer, peerId: number): void {
		if (!transfer.completionAcked) return;
		transfer.historyPending = false;
		const peer = this.#peers.get(peerId);
		if (peer?.recovery === transfer) peer.recovery = undefined;
		const pendingLive = transfer.pendingLive.splice(0);
		transfer.pendingLiveBytes = 0;
		for (const frame of pendingLive) this.#sendFrame(frame, peerId);
		transfer.peerId = null;
		this.#retainSnapshotTransfer(transfer);
	}

	#failSnapshotTransfer(transfer: SnapshotTransfer, reason: string, peerId: number): void {
		if (transfer.ackTimer !== null) clearTimeout(transfer.ackTimer);
		if (transfer.retentionTimer !== null) clearTimeout(transfer.retentionTimer);
		transfer.ackTimer = null;
		transfer.retentionTimer = null;
		const peer = this.#peers.get(peerId);
		if (peer?.recovery === transfer) peer.recovery = undefined;
		this.#sendFrame({ t: "error", message: reason }, peerId);
		if (this.#snapshotTransfers.get(transfer.resumeId) === transfer)
			this.#snapshotTransfers.delete(transfer.resumeId);
		transfer.pendingLive.length = 0;
		transfer.pendingLiveBytes = 0;
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
		if (!transfer || transfer.snapshotId !== frame.snapshotId || frame.recoveryEpoch !== transfer.recoveryEpoch) return;
		const result = transfer.sender.acknowledge(frame);
		if (result.exhausted) {
			this.#failSnapshotTransfer(transfer, "snapshot transfer retry exhausted", fromPeer);
			return;
		}
		this.#sendRecoveryChunks(transfer, result.chunks);
		if (result.complete) this.#finishSnapshotTransfer(transfer, fromPeer);
		else this.#armSnapshotAckTimer(transfer);
		if (frame.complete === true) this.#acceptSnapshotCompletion(transfer, frame, fromPeer);
	}

	#pageKey(peerId: number, snapshotId: string, cursor: string): string {
		return `${peerId}:${snapshotId}:${cursor}`;
	}

	#armSnapshotPageRetry(key: string, transfer: SnapshotPageTransfer): void {
		if (transfer.timer !== null) clearTimeout(transfer.timer);
		transfer.timer = setTimeout(() => {
			transfer.timer = null;
			if (this.#snapshotPages.get(key) !== transfer || this.#stopped || !this.#socket) return;
			const result = transfer.sender.onTimeout();
			if (result.exhausted) {
				this.#snapshotPages.delete(key);
				this.#sendFrame({ t: "error", message: "snapshot history page retry exhausted" }, transfer.peerId);
				return;
			}
			if (result.frame) this.#sendFrame(result.frame, transfer.peerId);
			this.#armSnapshotPageRetry(key, transfer);
		}, SNAPSHOT_PAGE_ACK_TIMEOUT_MS);
	}

	#handleSnapshotPageAck(frame: SnapshotPageAckFrame, fromPeer: number): void {
		const key = this.#pageKey(fromPeer, frame.snapshotId, frame.cursor);
		const pageTransfer = this.#snapshotPages.get(key);
		if (!pageTransfer || pageTransfer.recoveryEpoch !== frame.recoveryEpoch || !pageTransfer.sender.acknowledge(frame)) return;
		if (pageTransfer.timer !== null) clearTimeout(pageTransfer.timer);
		pageTransfer.timer = null;
		this.#snapshotPages.delete(key);
		if (pageTransfer.nextCursor !== undefined) return;
		const peerRecovery = this.#peers.get(fromPeer)?.recovery;
		const snapshotTransfer =
			peerRecovery?.snapshotId === frame.snapshotId
				? peerRecovery
				: [...this.#snapshotTransfers.values()].find(
						candidate => candidate.snapshotId === frame.snapshotId && candidate.peerId === fromPeer,
					);
		if (snapshotTransfer?.historyPending) this.#releaseSnapshotLive(snapshotTransfer, fromPeer);
	}

	#handleSnapshotPageRequest(frame: SnapshotPageRequestFrame, fromPeer: number): void {
		const peer = this.#peers.get(fromPeer);
		const transfer =
			peer?.recovery ??
			[...this.#snapshotTransfers.values()].find(
				candidate => candidate.snapshotId === frame.snapshotId && candidate.peerId === fromPeer,
			);
		if (
			!peer ||
			!transfer ||
			transfer.snapshotId !== frame.snapshotId ||
			transfer.peerId !== fromPeer ||
			frame.recoveryEpoch !== transfer.recoveryEpoch ||
			!transfer.completed ||
			!transfer.historyPending ||
			!this.#socket
		)
			return;
		const start = Number(frame.cursor);
		if (!Number.isSafeInteger(start) || start < 0 || start >= transfer.entries.length) return;
		let end = Math.min(start + SNAPSHOT_HISTORY_PAGE_ENTRIES, transfer.entries.length);
		while (end > start && snapshotJsonBytes(transfer.entries.slice(start, end)) > SNAPSHOT_CHUNK_BYTES) end--;
		if (end === start) {
			this.#sendFrame({ t: "error", message: "snapshot history entry exceeds the page size limit" }, fromPeer);
			return;
		}
		const payload = serializeSnapshotEntries(transfer.entries.slice(start, end));
		const page: SnapshotPageFrame = {
			t: "snapshot-page",
			snapshotId: transfer.snapshotId,
			recoveryEpoch: transfer.recoveryEpoch,
			cursor: frame.cursor,
			nextCursor: end < transfer.entries.length ? String(end) : undefined,
			payload: encodeSnapshotPayload(payload),
			checksum: checksumSnapshotPayload(payload),
		};
		if (snapshotJsonBytes(page) + 32 + 4 > MAX_ENCRYPTED_COLLAB_FRAME_BYTES) {
			this.#sendFrame({ t: "error", message: "snapshot history page exceeds encrypted frame limit" }, fromPeer);
			return;
		}
		const key = this.#pageKey(fromPeer, frame.snapshotId, frame.cursor);
		const old = this.#snapshotPages.get(key);
		if (old && old.timer !== null) clearTimeout(old.timer);
		if (!old) {
			const peerPageCount = [...this.#snapshotPages.values()].filter(candidate => candidate.peerId === fromPeer).length;
			if (peerPageCount >= MAX_PENDING_SNAPSHOT_PAGES_PER_PEER || this.#snapshotPages.size >= MAX_PENDING_SNAPSHOT_PAGES) {
				this.#sendFrame({ t: "error", message: "snapshot history page queue is full; retry shortly" }, fromPeer);
				return;
			}
		}
		const pending: SnapshotPageTransfer = {
			peerId: fromPeer,
			recoveryEpoch: transfer.recoveryEpoch,
			sender: new SnapshotPageSender(page),
			nextCursor: page.nextCursor,
			timer: null,
		};
		this.#snapshotPages.set(key, pending);
		this.#sendFrame(page, fromPeer);
		this.#armSnapshotPageRetry(key, pending);
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
		for (const [key, page] of this.#snapshotPages) {
			if (page.peerId !== peer) continue;
			if (page.timer !== null) clearTimeout(page.timer);
			this.#snapshotPages.delete(key);
		}
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
