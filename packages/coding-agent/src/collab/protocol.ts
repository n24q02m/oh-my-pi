/**
 * Collab live-session wire protocol.
 *
 * Hub topology: the host is authoritative, guests never peer. All session
 * payloads (`CollabFrame`) travel AES-256-GCM sealed; the relay only sees the
 * plaintext envelope (`[4B uint32 BE peerId][sealed payload]`) plus TEXT JSON
 * control messages that carry no session data.
 */

import { createHash } from "node:crypto";
import type { ImageContent, Model } from "@oh-my-pi/pi-ai";
import type {
	BusChannel,
	CollabUiRequest,
	GuestFrame,
	ParsedCollabLink,
	Participant,
	SessionState,
	AgentSnapshot as WireAgentSnapshot,
} from "@oh-my-pi/pi-wire";
import {
	DEFAULT_RELAY_URL,
	ENVELOPE_HEADER_LENGTH,
	ROOM_ID_BYTES,
	ROOM_KEY_BYTES,
	WRITE_TOKEN_BYTES,
} from "@oh-my-pi/pi-wire";
import type { ContextUsage } from "../extensibility/extensions/types";
import type { AgentSessionEvent } from "../session/agent-session";
import type { SessionEntry, SessionHeader } from "../session/session-entries";

export type {
	CollabPromptDetails,
	CollabUiRequest,
	CollabUiRequestDraft,
	CollabUiResponseValue,
	CollabUiSelectItem,
	ParsedCollabLink,
	RelayControlMessage,
	RelayControlToGuest,
	RelayControlToHost,
} from "@oh-my-pi/pi-wire";
export { COLLAB_PROMPT_MESSAGE_TYPE, COLLAB_PROTO } from "@oh-my-pi/pi-wire";
export { DEFAULT_RELAY_URL, ENVELOPE_HEADER_LENGTH, ROOM_ID_BYTES };

/** Maximum number of encrypted chunks that may be outstanding at once. */
export const SNAPSHOT_SEND_WINDOW = 4;
/** Number of sends (initial send plus bounded retransmissions) before exhaustion. */
export const SNAPSHOT_MAX_RETRIES = 4;
/** Highest number of holes carried in one ACK. */
export const SNAPSHOT_MAX_MISSING = 32;
export const SNAPSHOT_INITIAL_HISTORY_ENTRIES = 128;
export const SNAPSHOT_HISTORY_PAGE_ENTRIES = 128;
export const SNAPSHOT_ACK_TIMEOUT_MS = 250;
export const SNAPSHOT_MAX_RETAINED_TRANSFERS = 8;
export const SNAPSHOT_RESUME_RETENTION_MS = 5 * 60 * 1000;
/** Maximum unencrypted payload bytes carried by one recovery chunk. */
export const SNAPSHOT_CHUNK_PAYLOAD_BYTES = 64 * 1024;
/** Maximum number of retained payloads in one transfer. */
export const SNAPSHOT_MAX_PAYLOAD_COUNT = 4096;
/** Maximum decoded bytes retained by one snapshot transfer. */
export const SNAPSHOT_MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
/** Maximum session entries retained in one snapshot history. */
export const SNAPSHOT_MAX_ENTRY_COUNT = 16_384;
export const SNAPSHOT_PAGE_MAX_RETRIES = 4;
export const SNAPSHOT_PAGE_ACK_TIMEOUT_MS = 250;
export const SNAPSHOT_MAX_SEEN_CURSORS = 256;

export type SnapshotHello = {
	t: "hello";
	proto: number;
	name: string;
	writeToken?: string;
	snapshotRecovery?: boolean;
	resumeId?: string;
	snapshotId?: string;
	contiguousSeq?: number;
	missing?: number[];
};

export type SnapshotBeginFrame = {
	t: "snapshot-begin";
	snapshotId: string;
	total: number;
	entryCount?: number;
	firstHistoryCursor?: string;
};

export type SnapshotChunkFrame = {
	t: "snapshot-chunk";
	snapshotId: string;
	seq: number;
	total: number;
	payload: string;
	checksum: string;
	/** Compatibility fields are empty/false for recovery chunks. */
	entries: SessionEntry[];
	final: boolean;
};

export type SnapshotAckFrame = {
	t: "snapshot-ack";
	snapshotId: string;
	contiguousSeq: number;
	missing?: number[];
};

export type SnapshotEndFrame = {
	t: "snapshot-end";
	snapshotId: string;
	nextHistoryCursor?: string;
};

export type SnapshotPageRequestFrame = {
	t: "snapshot-page-request";
	snapshotId: string;
	cursor: string;
};

export type SnapshotPageFrame = {
	t: "snapshot-page";
	snapshotId: string;
	cursor: string;
	nextCursor?: string;
	payload: string;
	checksum: string;
};

export type SnapshotPageAckFrame = {
	t: "snapshot-page-ack";
	snapshotId: string;
	cursor: string;
};
export interface SnapshotPageSendResult {
	frame?: SnapshotPageFrame;
	complete: boolean;
	exhausted: boolean;
}

/** Retry state for one paginated history response. */
export class SnapshotPageSender {
	readonly #frame: SnapshotPageFrame;
	#attempts = 0;
	#acked = false;

	constructor(frame: SnapshotPageFrame) {
		this.#frame = frame;
	}

	acknowledge(ack: SnapshotPageAckFrame): boolean {
		if (ack.snapshotId !== this.#frame.snapshotId || ack.cursor !== this.#frame.cursor) return false;
		this.#acked = true;
		return true;
	}

	onTimeout(): SnapshotPageSendResult {
		if (this.#acked) return { complete: true, exhausted: false };
		if (this.#attempts >= SNAPSHOT_PAGE_MAX_RETRIES) return { complete: false, exhausted: true };
		this.#attempts++;
		return { frame: this.#frame, complete: false, exhausted: false };
	}
}

export function encodeSnapshotPayload(payload: Uint8Array): string {
	return Buffer.from(payload).toString("base64url");
}

export function decodeSnapshotPayload(payload: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]*$/.test(payload)) return null;
	try {
		return new Uint8Array(Buffer.from(payload, "base64url"));
	} catch {
		return null;
	}
}

export function checksumSnapshotPayload(payload: Uint8Array): string {
	return createHash("sha256").update(payload).digest("hex");
}

export function serializeSnapshotEntries(entries: readonly SessionEntry[]): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(entries));
}

export function splitSnapshotPayload(payload: Uint8Array, maxBytes = SNAPSHOT_CHUNK_PAYLOAD_BYTES): Uint8Array[] {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new Error("snapshot payload limit must be a positive integer");
	if (payload.byteLength === 0) return [new Uint8Array(0)];
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < payload.byteLength; offset += maxBytes) {
		chunks.push(payload.slice(offset, Math.min(offset + maxBytes, payload.byteLength)));
	}
	return chunks;
}

export interface SnapshotSendResult {
	chunks: SnapshotChunkFrame[];
	complete: boolean;
	exhausted: boolean;
}

/**
 * Pure ACK/window state for a single encrypted snapshot. Payloads stay in the
 * host's source snapshot; only the bounded in-flight sequence set is mutable
 * retransmission state.
 */
export class SnapshotSender {
	readonly snapshotId: string;
	readonly total: number;
	readonly #payloads: readonly Uint8Array[];
	readonly #attempts = new Map<number, number>();
	readonly #inFlight = new Set<number>();
	#nextSeq = 0;
	#contiguousSeq = -1;

	constructor(snapshotId: string, payloads: readonly Uint8Array[]) {
		if (!snapshotId) throw new Error("snapshot id is required");
		if (payloads.length > SNAPSHOT_MAX_PAYLOAD_COUNT) throw new Error("snapshot payload count exceeds limit");
		let totalBytes = 0;
		for (const payload of payloads) {
			if (payload.byteLength > SNAPSHOT_CHUNK_PAYLOAD_BYTES) throw new Error("snapshot payload chunk exceeds limit");
			totalBytes += payload.byteLength;
			if (totalBytes > SNAPSHOT_MAX_TRANSFER_BYTES) throw new Error("snapshot payload bytes exceed limit");
		}
		this.snapshotId = snapshotId;
		this.#payloads = payloads;
		this.total = payloads.length;
	}

	get contiguousSeq(): number {
		return this.#contiguousSeq;
	}

	get inFlightCount(): number {
		return this.#inFlight.size;
	}

	nextWindow(): SnapshotChunkFrame[] {
		const chunks: SnapshotChunkFrame[] = [];
		while (this.#inFlight.size < SNAPSHOT_SEND_WINDOW && this.#nextSeq < this.total) {
			const seq = this.#nextSeq++;
			this.#inFlight.add(seq);
			chunks.push(this.#frame(seq));
		}
		return chunks;
	}

	acknowledge(ack: SnapshotAckFrame, resendInFlight = false): SnapshotSendResult {
		if (ack.snapshotId !== this.snapshotId || this.total === 0)
			return { chunks: [], complete: this.total === 0, exhausted: false };
		if (Number.isSafeInteger(ack.contiguousSeq) && ack.contiguousSeq >= this.#contiguousSeq) {
			this.#contiguousSeq = Math.min(ack.contiguousSeq, this.total - 1);
			for (const seq of this.#inFlight) if (seq <= this.#contiguousSeq) this.#inFlight.delete(seq);
		}
		const missing = this.#boundedMissing(ack.missing);
		const chunks: SnapshotChunkFrame[] = [];
		for (const seq of resendInFlight ? [...this.#inFlight] : missing) {
			if (!this.#inFlight.has(seq)) continue;
			if (!resendInFlight && !missing.includes(seq)) continue;
			const retry = this.#retry(seq);
			if (retry.exhausted) return { chunks: [], complete: false, exhausted: true };
			chunks.push(retry.chunk!);
		}
		if (this.#contiguousSeq >= this.total - 1) return { chunks, complete: true, exhausted: false };
		chunks.push(...this.nextWindow());
		return { chunks, complete: false, exhausted: false };
	}

	onTimeout(): SnapshotSendResult {
		if (this.#contiguousSeq >= this.total - 1) return { chunks: [], complete: true, exhausted: false };
		if (this.#inFlight.size === 0) return { chunks: this.nextWindow(), complete: false, exhausted: false };
		const chunks: SnapshotChunkFrame[] = [];
		for (const seq of this.#inFlight) {
			const retry = this.#retry(seq);
			if (retry.exhausted) return { chunks: [], complete: false, exhausted: true };
			chunks.push(retry.chunk!);
		}
		return { chunks, complete: false, exhausted: false };
	}

	#boundedMissing(missing: number[] | undefined): number[] {
		if (!missing) return [];
		const result: number[] = [];
		for (const seq of missing) {
			if (result.length >= SNAPSHOT_MAX_MISSING) break;
			if (Number.isSafeInteger(seq) && seq > this.#contiguousSeq && seq < this.total && !result.includes(seq))
				result.push(seq);
		}
		return result;
	}

	#retry(seq: number): { chunk?: SnapshotChunkFrame; exhausted: boolean } {
		const attempts = this.#attempts.get(seq) ?? 0;
		if (attempts >= SNAPSHOT_MAX_RETRIES) return { exhausted: true };
		this.#attempts.set(seq, attempts + 1);
		return { chunk: this.#frame(seq), exhausted: false };
	}

	#frame(seq: number): SnapshotChunkFrame {
		const payload = this.#payloads[seq];
		if (!payload) throw new Error(`missing snapshot payload ${seq}`);
		return {
			t: "snapshot-chunk",
			snapshotId: this.snapshotId,
			seq,
			total: this.total,
			payload: encodeSnapshotPayload(payload),
			checksum: checksumSnapshotPayload(payload),
			entries: [],
			final: false,
		};
	}
}

export type SnapshotReceiveResult = {
	ack: SnapshotAckFrame;
	accepted: boolean;
	duplicate: boolean;
	corrupt: boolean;
};

/** Guest-side deduplicating/reordering state for one snapshot ID. */
export class SnapshotReceiver {
	#snapshotId: string | null = null;
	#total = 0;
	#contiguousSeq = -1;
	#bytes = 0;
	readonly #chunks = new Map<number, Uint8Array>();
	get snapshotId(): string | null {
		return this.#snapshotId;
	}

	get total(): number {
		return this.#total;
	}

	get contiguousSeq(): number {
		return this.#contiguousSeq;
	}

	get receivedCount(): number {
		return this.#chunks.size;
	}

	begin(frame: SnapshotBeginFrame): "new" | "resumed" | "replaced" {
		if (!this.#snapshotId) {
			this.#reset(frame);
			return "new";
		}
		if (this.#snapshotId === frame.snapshotId && this.#total === frame.total) return "resumed";
		this.#reset(frame);
		return "replaced";
	}

	ack(extraMissing?: number): SnapshotAckFrame {
		if (!this.#snapshotId) throw new Error("snapshot has not begun");
		const missing: number[] = [];
		if (extraMissing !== undefined && extraMissing > this.#contiguousSeq && extraMissing < this.#total)
			missing.push(extraMissing);
		for (
			let seq = this.#contiguousSeq + 1;
			seq < this.#highestReceived() && missing.length < SNAPSHOT_MAX_MISSING;
			seq++
		) {
			if (!this.#chunks.has(seq) && !missing.includes(seq)) missing.push(seq);
		}
		return {
			t: "snapshot-ack",
			snapshotId: this.#snapshotId,
			contiguousSeq: this.#contiguousSeq,
			missing: missing.length > 0 ? missing : undefined,
		};
	}

	accept(frame: SnapshotChunkFrame): SnapshotReceiveResult {
		const invalidAck = this.ackFor(frame.snapshotId);
		if (
			frame.snapshotId !== this.#snapshotId ||
			frame.total !== this.#total ||
			!Number.isSafeInteger(frame.seq) ||
			frame.seq < 0 ||
			frame.seq >= this.#total
		) {
			return { ack: invalidAck, accepted: false, duplicate: false, corrupt: false };
		}
		const payload = decodeSnapshotPayload(frame.payload);
		if (
			!payload ||
			checksumSnapshotPayload(payload) !== frame.checksum ||
			payload.byteLength > SNAPSHOT_CHUNK_PAYLOAD_BYTES
		) {
			return { ack: this.ack(frame.seq), accepted: false, duplicate: false, corrupt: true };
		}
		const previous = this.#chunks.get(frame.seq);
		if (previous) return { ack: this.ack(), accepted: false, duplicate: true, corrupt: false };
		if (this.#bytes + payload.byteLength > SNAPSHOT_MAX_TRANSFER_BYTES) {
			return { ack: this.ack(frame.seq), accepted: false, duplicate: false, corrupt: true };
		}
		this.#chunks.set(frame.seq, payload);
		this.#bytes += payload.byteLength;
		while (this.#chunks.has(this.#contiguousSeq + 1)) this.#contiguousSeq++;
		return { ack: this.ack(), accepted: true, duplicate: false, corrupt: false };
	}

	assemble(): Uint8Array {
		if (!this.#snapshotId || this.#chunks.size !== this.#total || this.#contiguousSeq !== this.#total - 1) {
			throw new Error("snapshot is incomplete");
		}
		const length = [...this.#chunks.values()].reduce((sum, chunk) => sum + chunk.byteLength, 0);
		const output = new Uint8Array(length);
		let offset = 0;
		for (let seq = 0; seq < this.#total; seq++) {
			const chunk = this.#chunks.get(seq);
			if (!chunk) throw new Error(`missing snapshot chunk ${seq}`);
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return output;
	}

	#reset(frame: SnapshotBeginFrame): void {
		if (
			!frame.snapshotId ||
			!Number.isSafeInteger(frame.total) ||
			frame.total < 0 ||
			frame.total > SNAPSHOT_MAX_PAYLOAD_COUNT
		)
			throw new Error("invalid snapshot total");
		this.#snapshotId = frame.snapshotId;
		this.#total = frame.total;
		this.#contiguousSeq = -1;
		this.#bytes = 0;
		this.#chunks.clear();
	}

	#highestReceived(): number {
		let highest = this.#contiguousSeq;
		for (const seq of this.#chunks.keys()) highest = Math.max(highest, seq);
		return highest;
	}

	ackFor(snapshotId: string): SnapshotAckFrame {
		return { t: "snapshot-ack", snapshotId, contiguousSeq: this.#contiguousSeq };
	}
}

export type CollabParticipant = Participant;
export type AgentSnapshot = WireAgentSnapshot;

/** Debounced footer snapshot broadcast by the host. */
export type CollabSessionState = SessionState & {
	/**
	 * Host model (full catalog object). Guests apply it to their replica
	 * agent state so model display and context-window math are native.
	 */
	model?: Model;
	/** Host status-line context numbers (guest system prompt/tools differ, so local estimates drift). */
	contextUsage?: ContextUsage;
};

/**
 * Encrypted payload frames (inside AES-GCM, JSON). The wire package pins the
 * JSON skeleton (`WireFrame`); host-side frames carry the rich session types
 * that serialize into those shapes.
 */

export type CollabFrame =
	// guest -> host (hello/abort/agent-cmd/fetch-transcript/ui-response are taken verbatim from the wire grammar)
	| Exclude<GuestFrame, { t: "prompt" | "hello" }>
	| SnapshotHello
	| { t: "prompt"; text: string; images?: ImageContent[] }
	| SnapshotPageRequestFrame
	| SnapshotPageAckFrame
	// host -> guest
	| {
			t: "welcome";
			proto: number;
			header: SessionHeader;
			state: CollabSessionState;
			agents: AgentSnapshot[];
			/** Total number of legacy SessionEntry items following the welcome. */
			entryCount: number;
			/** True when this peer joined through a read-only (view) link. */
			readOnly?: boolean;
	  }
	/** Legacy chunk frame retained for guests that did not negotiate recovery. */
	| { t: "snapshot-chunk"; entries: SessionEntry[]; final: boolean }
	| SnapshotBeginFrame
	| SnapshotChunkFrame
	| SnapshotAckFrame
	| SnapshotEndFrame
	| SnapshotPageFrame
	| { t: "entry"; entry: SessionEntry }
	| { t: "event"; event: AgentSessionEvent }
	| { t: "state"; state: CollabSessionState }
	/** Mirrored EventBus traffic (task subagent lifecycle/progress channels only). */
	| { t: "bus"; channel: BusChannel; data: unknown }
	/** Full agent-registry snapshot (debounced on registry change). */
	| { t: "agents"; agents: AgentSnapshot[] }
	| { t: "ui-request"; request: CollabUiRequest }
	| { t: "ui-request-end"; reqId: number }
	/** Targeted reply to fetch-transcript; error marks a terminal read failure that guests must surface without hot retrying. */
	| { t: "transcript"; reqId: number; text: string; newSize: number; error?: string }
	| { t: "bye"; reason: string }
	| { t: "error"; message: string };

// ═══════════════════════════════════════════════════════════════════════════
// Wire envelope: [4B uint32 BE peerId][sealed payload]
// Host→relay: peerId 0 broadcasts to all guests; peerId N targets guest N.
// Guest→relay: always 0; the relay rewrites it to the sender's id.
// ═══════════════════════════════════════════════════════════════════════════

export function packEnvelope(peerId: number, sealed: Uint8Array): Uint8Array {
	const out = new Uint8Array(ENVELOPE_HEADER_LENGTH + sealed.byteLength);
	new DataView(out.buffer).setUint32(0, peerId, false);
	out.set(sealed, ENVELOPE_HEADER_LENGTH);
	return out;
}

export function unpackEnvelope(data: Uint8Array): { peerId: number; payload: Uint8Array } | null {
	if (data.byteLength < ENVELOPE_HEADER_LENGTH) return null;
	const peerId = new DataView(data.buffer, data.byteOffset, ENVELOPE_HEADER_LENGTH).getUint32(0, false);
	return { peerId, payload: data.subarray(ENVELOPE_HEADER_LENGTH) };
}

/** Rewrite the peerId in place without copying the payload. */
export function rewriteEnvelopePeer(data: Uint8Array, peerId: number): void {
	new DataView(data.buffer, data.byteOffset, ENVELOPE_HEADER_LENGTH).setUint32(0, peerId, false);
}

// ═══════════════════════════════════════════════════════════════════════════
// Link format: wss://<host[:port]>/r/<roomId>.<base64url-32-byte-key>
// ═══════════════════════════════════════════════════════════════════════════

const ROOM_PATH_RE = /^\/r\/([A-Za-z0-9_-]{10,64})(?:\.([A-Za-z0-9_-]+))?$/;
const BARE_LINK_RE = /^([A-Za-z0-9_-]{10,64})[#.]([A-Za-z0-9_-]+)$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const LOCAL_HOSTNAMES: Record<string, true> = { localhost: true, "127.0.0.1": true, "::1": true, "[::1]": true };

function isLocalHostname(hostname: string): boolean {
	return LOCAL_HOSTNAMES[hostname] === true;
}

export function generateRoomId(): string {
	const bytes = new Uint8Array(ROOM_ID_BYTES);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString("base64url");
}

/** Normalize a relay base URL (ws/wss/http/https) into a ws/wss origin, or an error. */
function normalizeRelayOrigin(relayUrl: string): { origin: string } | { error: string } {
	let url: URL;
	try {
		url = new URL(relayUrl);
	} catch {
		return { error: `Invalid relay URL: ${relayUrl}` };
	}
	let scheme: string;
	switch (url.protocol) {
		case "wss:":
		case "https:":
			scheme = "wss:";
			break;
		case "ws:":
		case "http:":
			scheme = "ws:";
			break;
		default:
			return { error: `Unsupported relay URL scheme: ${url.protocol}` };
	}
	if (scheme === "ws:" && !isLocalHostname(url.hostname)) {
		return { error: "relay link must be wss:// (plain ws:// is only allowed for localhost)" };
	}
	const port = url.port ? `:${url.port}` : "";
	return { origin: `${scheme}//${url.hostname}${port}` };
}

/**
 * Render the shareable link. Compact forms: the default relay collapses to
 * `<roomId>.<key>`, other wss relays drop the scheme (`host[:port]/r/…`);
 * only localhost ws:// links keep their full URL so parsing cannot
 * mis-infer wss.
 *
 * The room secret is dot-joined (`<roomId>.<key>`) rather than `#`-joined:
 * RFC 3986 forbids a raw `#` inside a fragment, so strict URL stacks (macOS
 * Foundation behind terminal click-to-open) percent-encode a second `#` to
 * `%23` and break the link. Parsers still accept the legacy `#` form and the
 * mangled `%23` form.
 *
 * Full links append the write token to the key
 * (`base64url(key ∥ writeToken)`); read-only (view) links carry the bare
 * 32-byte key, which is also the pre-token link format.
 */
export function formatCollabLink(relayUrl: string, roomId: string, key: Uint8Array, writeToken?: Uint8Array): string {
	const normalized = normalizeRelayOrigin(relayUrl);
	if ("error" in normalized) throw new Error(normalized.error);
	const secret = writeToken ? Buffer.concat([key, writeToken]) : Buffer.from(key);
	const keyText = secret.toString("base64url");
	if (normalized.origin === DEFAULT_RELAY_URL) return `${roomId}.${keyText}`;
	const compact = normalized.origin.startsWith("wss://")
		? normalized.origin.slice("wss://".length)
		: normalized.origin;
	return `${compact}/r/${roomId}.${keyText}`;
}

function normalizeCollabWebBaseUrl(relayUrl: string, webUrl?: string): string {
	const explicitWebUrl = webUrl?.trim();
	if (!explicitWebUrl) {
		const normalized = normalizeRelayOrigin(relayUrl);
		if ("error" in normalized) throw new Error(normalized.error);
		return normalized.origin.startsWith("wss://")
			? `https://${normalized.origin.slice("wss://".length)}`
			: `http://${normalized.origin.slice("ws://".length)}`;
	}

	let url: URL;
	try {
		url = new URL(explicitWebUrl);
	} catch {
		throw new Error("collab.webUrl must start with http:// or https://");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("collab.webUrl must start with http:// or https://");
	}
	if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
		throw new Error("collab.webUrl must use https:// unless it targets localhost");
	}
	if (url.search || url.hash) {
		throw new Error("collab.webUrl must not include a query string or fragment");
	}
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}`;
}

/**
 * Render the browser deep link. The browser UI may be hosted separately from
 * the relay; the fragment always carries the relay-specific collab link, so
 * room secrets stay out of HTTP path and query bytes.
 */
export function formatCollabWebLink(
	relayUrl: string,
	roomId: string,
	key: Uint8Array,
	writeToken?: Uint8Array,
	webUrl?: string,
): string {
	return `${normalizeCollabWebBaseUrl(relayUrl, webUrl)}/#${formatCollabLink(relayUrl, roomId, key, writeToken)}`;
}

export function parseCollabLink(link: string): ParsedCollabLink | { error: string } {
	// Lenient input: terminals that open OSC 8 links through strict URL stacks
	// (macOS Foundation) percent-encode the legacy second `#` to `%23`.
	let text = link.trim().replace(/%23/gi, "#");
	// Bare `<roomId>.<key>` (legacy `<roomId>#<key>`) → default relay.
	const bare = BARE_LINK_RE.exec(text);
	if (bare) text = `${DEFAULT_RELAY_URL}/r/${bare[1]}.${bare[2]}`;
	// Scheme-less `host[:port]/r/…` → wss.
	else if (!text.includes("://")) text = `wss://${text}`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return { error: `Invalid collab link: ${link}` };
	}
	if ((url.protocol === "http:" || url.protocol === "https:") && url.hash) {
		const inner = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
		const parsed = parseCollabLink(inner);
		if (!("error" in parsed)) return parsed;
	}
	const normalized = normalizeRelayOrigin(url.origin);
	if ("error" in normalized) return normalized;
	const match = ROOM_PATH_RE.exec(url.pathname);
	if (!match) {
		// Non-http(s) deep links may also carry a complete collab link in the
		// fragment. http(s) links are handled once above so invalid fragments
		// fall through to direct relay validation instead of double-recursing.
		const inner = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
		if (inner && url.protocol !== "http:" && url.protocol !== "https:") return parseCollabLink(inner);
		return { error: "Collab link must contain a /r/<roomId> path" };
	}
	const roomId = match[1]!;
	// Key rides dot-joined in the path (`/r/<roomId>.<key>`); legacy links
	// carry it in the fragment (`/r/<roomId>#<key>`).
	const fragment = match[2] ?? (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
	if (!fragment) {
		return { error: "Collab link is missing the <key> part" };
	}
	const secret = B64URL_RE.test(fragment) ? new Uint8Array(Buffer.from(fragment, "base64url")) : null;
	if (!secret || (secret.byteLength !== ROOM_KEY_BYTES && secret.byteLength !== ROOM_KEY_BYTES + WRITE_TOKEN_BYTES)) {
		return { error: "Collab link key must be 32 (view) or 48 (full) base64url bytes" };
	}
	const key = secret.subarray(0, ROOM_KEY_BYTES);
	const writeToken = secret.byteLength > ROOM_KEY_BYTES ? secret.subarray(ROOM_KEY_BYTES) : undefined;
	return { wsUrl: `${normalized.origin}/r/${roomId}`, roomId, key, writeToken };
}
