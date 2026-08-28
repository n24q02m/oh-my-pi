/**
 * Hard-cap helper for host→guest collab frames.
 *
 * The host wraps every {@link CollabFrame} in an AES-GCM envelope and ships it
 * through the relay's WebSocket. WebSocket servers enforce a per-frame
 * `maxPayloadLength` (Bun's default is 16 MB; many proxies cap lower). A
 * single oversized payload — typically a `read`/`bash`/`search` tool result
 * captured as one multi-megabyte string, or a tool result whose `content`
 * array holds thousands of small blocks — would otherwise ship as its own
 * oversized frame and trip that limit, killing the host's WebSocket with
 * `1006 Received too big message`. `CollabSocket` treats 1006 as transient
 * and reconnects, the next guest hello triggers the same oversized send, and
 * the loop never breaks (issue #3739).
 *
 * This helper bounds any JSON-serializable payload below the encrypted
 * WebSocket frame budget represented by
 * {@link MAX_REPLICATED_PAYLOAD_BYTES}. Already-small payloads pass through
 * untouched; oversized ones are returned as a deep-cloned shadow where long
 * strings are head-truncated AND long arrays are head-clipped, with
 * `[…N chars elided for collab session]` / `[…N items elided for collab
 * session]` markers. Both axes are needed: string truncation alone leaves
 * the cap unenforced for a payload built of many short strings, where no
 * field exceeds the per-string floor.
 */

/**
 * Per-payload ceiling for host→guest frames. Bun's default WebSocket
 * `maxPayloadLength` is 16 MB; we leave a generous margin so the AES-GCM
 * envelope (+ IV + tag), the 4-byte peer header, and the outer wire wrapper
 * fit comfortably under that on every reasonable relay.
 */
export const MAX_REPLICATED_PAYLOAD_BYTES = 96 * 1024;
const replicationEncoder = new TextEncoder();

function serializedBytes(value: unknown): number {
	try {
		return replicationEncoder.encode(JSON.stringify(value)).byteLength;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * Progressive shrink passes. Each pass tightens both the per-string cap,
 * the per-array head limit, and the per-object property limit. The loop stops
 * at the first pass whose output fits {@link MAX_REPLICATED_PAYLOAD_BYTES}.
 */
interface ShrinkPass {
	stringCap: number;
	arrayLimit: number;
	objectLimit?: number;
}

const SHRINK_PASSES: readonly ShrinkPass[] = [
	{ stringCap: 64 * 1024, arrayLimit: 256, objectLimit: 512 },
	{ stringCap: 16 * 1024, arrayLimit: 128, objectLimit: 256 },
	{ stringCap: 4 * 1024, arrayLimit: 64, objectLimit: 128 },
	{ stringCap: 1 * 1024, arrayLimit: 32, objectLimit: 64 },
	{ stringCap: 256, arrayLimit: 16, objectLimit: 32 },
	{ stringCap: 256, arrayLimit: 4, objectLimit: 16 },
	{ stringCap: 64, arrayLimit: 1, objectLimit: 4 },
];

const STRING_ELISION_RESERVE = 80;

/**
 * Recursively walk `value`, head-truncating strings, clipping arrays,
 * and bounding object property counts.
 */
function shrinkWalk(value: unknown, stringCap: number, arrayLimit: number, objectLimit = 512): unknown {
	if (typeof value === "string") {
		if (value.length <= stringCap) return value;
		const headLen = Math.max(0, stringCap - STRING_ELISION_RESERVE);
		return `${value.slice(0, headLen)}\n…[${value.length - headLen} chars elided for collab session]`;
	}
	if (Array.isArray(value)) {
		const keep = Math.min(value.length, arrayLimit);
		const elided = value.length - keep;
		const out: unknown[] = new Array(elided > 0 ? keep + 1 : keep);
		for (let i = 0; i < keep; i++) out[i] = shrinkWalk(value[i], stringCap, arrayLimit, objectLimit);
		if (elided > 0) out[keep] = `…[${elided} items elided for collab session]`;
		return out;
	}
	if (value && typeof value === "object") {
		const src = value as Record<string, unknown>;
		const keys = Object.keys(src);
		const keep = Math.min(keys.length, objectLimit);
		const out: Record<string, unknown> = {};
		for (let i = 0; i < keep; i++) {
			const k = keys[i]!;
			out[k] = shrinkWalk(src[k], stringCap, arrayLimit, objectLimit);
		}
		if (keys.length > keep) {
			out._elided_keys_ = `…[${keys.length - keep} properties elided for collab session]`;
		}
		return out;
	}
	return value;
}

/**
 * Return `value` unchanged when its JSON serialization already fits
 * {@link MAX_REPLICATED_PAYLOAD_BYTES}; otherwise return a deep-cloned
 * shadow shrunk along string, array, and object axes until the payload fits.
 */
export function shrinkForReplication<T>(value: T): T {
	if (serializedBytes(value) <= MAX_REPLICATED_PAYLOAD_BYTES) return value;
	let shrunk: unknown = value;
	for (const pass of SHRINK_PASSES) {
		shrunk = shrinkWalk(value, pass.stringCap, pass.arrayLimit, pass.objectLimit);
		if (serializedBytes(shrunk) <= MAX_REPLICATED_PAYLOAD_BYTES) return shrunk as T;
	}
	// Fallback guarantee: if still oversized (e.g. giant key names), return minimal safe envelope
	if (serializedBytes(shrunk) > MAX_REPLICATED_PAYLOAD_BYTES && typeof shrunk === "object" && shrunk !== null) {
		const rec = shrunk as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		if ("t" in rec) out.t = rec.t;
		if ("type" in rec) out.type = rec.type;
		if ("id" in rec) out.id = rec.id;
		out._elided_ = "[payload elided: exceeded replication byte limit]";
		return out as T;
	}
	return shrunk as T;
}
