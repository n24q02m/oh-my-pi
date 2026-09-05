import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import type { SessionEntry } from "./session-manager";

export const TOOL_EXECUTION_START_CUSTOM_TYPE = "tool_execution_start";
export const SESSION_EXIT_CUSTOM_TYPE = "session_exit";
export const SESSION_LIVENESS_CUSTOM_TYPE = "session_liveness";

export type SessionLivenessOperation = "provider_stream" | "tool_execution" | "retry_wait";
export type SessionLivenessPhase = "start" | "progress" | "wait" | "end";

/** Sanitized evidence that a durable session operation was in progress. */
export interface SessionLivenessData {
	recordedAt: string;
	operation: SessionLivenessOperation;
	operationId: string;
	phase: SessionLivenessPhase;
	provider?: string;
	model?: string;
	toolName?: string;
	watchdogMs?: number;
}

export interface SessionLivenessRecord {
	index: number;
	data: SessionLivenessData;
}

/**
 * Process outcome recorded only when the runtime observed a concrete signal or
 * exit code. A sentinel that only observes parent disappearance uses unknown.
 */
export interface SessionProcessOutcome {
	observation: "known" | "unknown";
	observedBy: "parent" | "sentinel";
	exitCode?: number;
	signal?: string;
}

/**
 * Compact projection of tool-call arguments persisted with the start marker.
 * The assistant message already carries the full arguments; this exists only
 * so `appendArgumentSummary` can name the command/path in resume warnings
 * without duplicating whole argument payloads into the session JSONL.
 */
export interface ToolArgumentSummary {
	command?: string;
	path?: string;
}

/** Persisted marker written before a tool implementation starts running. */
export interface ToolExecutionStartData {
	toolCallId: string;
	toolName: string;
	args?: ToolArgumentSummary;
	intent?: string;
	startedAt: string;
}

/** Tool call left without a matching toolResult at the end of a branch. */
export interface PendingToolCallDiagnostic {
	toolCallId?: string;
	toolName: string;
	args?: unknown;
	intent?: string;
	assistantTimestamp?: number;
	startedAt?: string;
}

/** Session shutdown marker written during normal and fatal process teardown. */
export interface SessionExitData {
	reason: string;
	kind: "normal" | "signal" | "fatal" | "process_exit" | "abnormal";
	recordedAt: string;
	pendingToolCalls?: PendingToolCallDiagnostic[];
	lastLiveness?: SessionLivenessData;
	processOutcome?: SessionProcessOutcome;
}

interface PendingToolCallRecord extends PendingToolCallDiagnostic {
	key: string;
}

interface ToolCallContent {
	type: "toolCall";
	id?: string;
	name?: string;
	arguments?: unknown;
}

export interface AssistantModelMetadata {
	api: AssistantMessage["api"];
	provider: string;
	model: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object") return false;
	return value !== null;
}

function isSessionLivenessOperation(value: unknown): value is SessionLivenessOperation {
	return value === "provider_stream" || value === "tool_execution" || value === "retry_wait";
}

function isSessionLivenessPhase(value: unknown): value is SessionLivenessPhase {
	return value === "start" || value === "progress" || value === "wait" || value === "end";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readSessionLivenessData(value: unknown): SessionLivenessData | undefined {
	if (!isObject(value)) return undefined;
	const { recordedAt, operation, operationId, phase, provider, model, toolName, watchdogMs } = value;
	if (
		typeof recordedAt !== "string" ||
		!isSessionLivenessOperation(operation) ||
		typeof operationId !== "string" ||
		operationId.length === 0 ||
		!isSessionLivenessPhase(phase) ||
		(provider !== undefined && typeof provider !== "string") ||
		(model !== undefined && typeof model !== "string") ||
		(toolName !== undefined && typeof toolName !== "string") ||
		(watchdogMs !== undefined && !isNonNegativeSafeInteger(watchdogMs))
	) {
		return undefined;
	}
	const data: SessionLivenessData = { recordedAt, operation, operationId, phase };
	if (provider !== undefined) data.provider = provider;
	if (model !== undefined) data.model = model;
	if (toolName !== undefined) data.toolName = toolName;
	if (watchdogMs !== undefined) data.watchdogMs = watchdogMs;
	return data;
}

function readSessionProcessOutcome(value: unknown): SessionProcessOutcome | undefined {
	if (!isObject(value)) return undefined;
	const { observation, observedBy, exitCode, signal } = value;
	if (
		(observation !== "known" && observation !== "unknown") ||
		(observedBy !== "parent" && observedBy !== "sentinel") ||
		(exitCode !== undefined && !isNonNegativeSafeInteger(exitCode)) ||
		(signal !== undefined && (typeof signal !== "string" || signal.length === 0))
	) {
		return undefined;
	}
	if (observation === "unknown") {
		if (exitCode !== undefined || signal !== undefined) return undefined;
		return { observation, observedBy };
	}
	if ((exitCode === undefined && signal === undefined) || (exitCode !== undefined && signal !== undefined)) {
		return undefined;
	}
	if (exitCode !== undefined) return { observation, observedBy, exitCode };
	if (signal === undefined) return undefined;
	return { observation, observedBy, signal };
}
function isPendingToolCallDiagnostic(value: unknown): value is PendingToolCallDiagnostic {
	if (!isObject(value) || typeof value.toolName !== "string") return false;
	if ("toolCallId" in value && typeof value.toolCallId !== "string") return false;
	if ("intent" in value && typeof value.intent !== "string") return false;
	if ("assistantTimestamp" in value && typeof value.assistantTimestamp !== "number") return false;
	if ("startedAt" in value && typeof value.startedAt !== "string") return false;
	return true;
}

function readPendingToolCalls(value: unknown): PendingToolCallDiagnostic[] | undefined {
	if (!Array.isArray(value) || !value.every(isPendingToolCallDiagnostic)) return undefined;
	return value;
}

function readSessionExit(entry: SessionEntry): SessionExitData | undefined {
	if (entry.type !== "custom" || entry.customType !== SESSION_EXIT_CUSTOM_TYPE || !isObject(entry.data)) {
		return undefined;
	}
	const { reason, kind, recordedAt } = entry.data;
	if (
		typeof reason !== "string" ||
		(kind !== "normal" && kind !== "signal" && kind !== "fatal" && kind !== "process_exit" && kind !== "abnormal") ||
		typeof recordedAt !== "string"
	) {
		return undefined;
	}
	const data: SessionExitData = {
		reason,
		kind,
		recordedAt,
		pendingToolCalls: readPendingToolCalls(entry.data.pendingToolCalls),
	};
	const lastLiveness = readSessionLivenessData(entry.data.lastLiveness);
	const processOutcome = readSessionProcessOutcome(entry.data.processOutcome);
	if (lastLiveness) data.lastLiveness = lastLiveness;
	if (processOutcome) data.processOutcome = processOutcome;
	return data;
}

export function findLastSessionLiveness(entries: readonly SessionEntry[]): SessionLivenessRecord | undefined {
	const active = new Map<string, SessionLivenessRecord>();
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index]!;
		if (entry.type !== "custom" || entry.customType !== SESSION_LIVENESS_CUSTOM_TYPE) continue;
		const data = readSessionLivenessData(entry.data);
		if (!data) continue;
		if (data.phase === "end") {
			active.delete(data.operationId);
			continue;
		}
		active.set(data.operationId, { index, data });
	}
	let latest: SessionLivenessRecord | undefined;
	for (const candidate of active.values()) {
		if (!latest || candidate.index > latest.index) latest = candidate;
	}
	return latest;
}

export function hasSessionExitAfter(entries: readonly SessionEntry[], index: number): boolean {
	for (let candidateIndex = index + 1; candidateIndex < entries.length; candidateIndex++) {
		if (readSessionExit(entries[candidateIndex]!)) return true;
	}
	return false;
}

/**
 * createInterruptedTurnAbortMessage returns a terminal assistant record when
 * the latest persisted process exit follows a non-terminal conversation tail.
 */
export function createInterruptedTurnAbortMessage(
	entries: readonly SessionEntry[],
	fallbackModel?: AssistantModelMetadata,
): AssistantMessage | undefined {
	const liveness = findLastSessionLiveness(entries);
	let exitIndex = -1;
	let exit: SessionExitData | undefined;
	for (let index = entries.length - 1; index >= 0; index--) {
		const candidate = readSessionExit(entries[index]!);
		if (!candidate) continue;
		exitIndex = index;
		exit = candidate;
		break;
	}
	if (!exit || (liveness && exitIndex < liveness.index)) {
		if (!liveness) return undefined;
		exitIndex = liveness.index;
		exit = {
			reason: "parent_disappeared",
			kind: "abnormal",
			recordedAt: liveness.data.recordedAt,
			lastLiveness: liveness.data,
			processOutcome: { observation: "unknown", observedBy: "sentinel" },
		};
	}
	if (exit.kind === "normal" && !exit.pendingToolCalls?.length) return undefined;

	let tailIndex = -1;
	let tail: AgentMessage | undefined;
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]!;
		if (entry.type !== "message") continue;
		tailIndex = index;
		tail = entry.message;
		break;
	}
	if (!tail || tailIndex > exitIndex) return undefined;
	if (tail.role === "assistant" && !tail.content.some(isToolCallContent)) return undefined;

	let previousAssistant: AssistantMessage | undefined;
	for (let index = tailIndex; index >= 0; index--) {
		const entry = entries[index]!;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		previousAssistant = entry.message;
		break;
	}
	if (
		tail.role === "toolResult" &&
		(previousAssistant?.stopReason === "error" || previousAssistant?.stopReason === "aborted")
	) {
		return undefined;
	}
	const model = previousAssistant ?? fallbackModel;
	if (!model) return undefined;

	const recordedAt = Date.parse(exit.recordedAt);
	const errorMessage =
		exit.processOutcome?.observation === "unknown"
			? "Previous OMP process stopped before completing the turn; its exit outcome could not be observed."
			: "Previous OMP process exited before completing the turn.";
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "aborted",
		errorMessage,
		timestamp: Number.isFinite(recordedAt) ? recordedAt : Date.now(),
	};
}

function isToolCallContent(value: unknown): value is ToolCallContent {
	if (!isObject(value)) return false;
	return value.type === "toolCall" && (typeof value.name === "string" || typeof value.id === "string");
}

/** Character cap for each summarized argument field. */
const ARGUMENT_SUMMARY_MAX_CHARS = 200;

function truncateSummaryField(value: string): string {
	return value.length > ARGUMENT_SUMMARY_MAX_CHARS ? `${value.slice(0, ARGUMENT_SUMMARY_MAX_CHARS)}…` : value;
}

/**
 * Project full tool-call arguments down to the fields the pending-tool-call
 * resume warning actually renders (`command`/`path`), truncated. Returns
 * `undefined` when the arguments carry neither, so callers can omit `args`
 * entirely instead of persisting an empty object.
 */
export function summarizeToolArguments(args: unknown): ToolArgumentSummary | undefined {
	if (!isObject(args)) return undefined;
	const summary: ToolArgumentSummary = {};
	if (typeof args.command === "string" && args.command.length > 0) {
		summary.command = truncateSummaryField(args.command);
	}
	if (typeof args.path === "string" && args.path.length > 0) {
		summary.path = truncateSummaryField(args.path);
	}
	return summary.command !== undefined || summary.path !== undefined ? summary : undefined;
}

function readToolExecutionStart(entry: SessionEntry): ToolExecutionStartData | undefined {
	if (entry.type !== "custom" || entry.customType !== TOOL_EXECUTION_START_CUSTOM_TYPE) return undefined;
	const data = entry.data;
	if (!isObject(data)) return undefined;
	if (typeof data.toolCallId !== "string" || typeof data.toolName !== "string") return undefined;
	const startedAt = typeof data.startedAt === "string" ? data.startedAt : entry.timestamp;
	const result: ToolExecutionStartData = {
		toolCallId: data.toolCallId,
		toolName: data.toolName,
		startedAt,
	};
	// Legacy sessions persisted full argument objects; project them down.
	if ("args" in data) {
		const args = summarizeToolArguments(data.args);
		if (args) result.args = args;
	}
	if (typeof data.intent === "string") result.intent = data.intent;
	return result;
}

function appendAssistantToolCalls(pending: Map<string, PendingToolCallRecord>, message: AgentMessage): void {
	if (message.role !== "assistant") return;
	const content = Array.isArray(message.content) ? message.content : [];
	const toolCalls: PendingToolCallRecord[] = [];
	for (let index = 0; index < content.length; index++) {
		const part = content[index];
		if (!isToolCallContent(part)) continue;
		const toolName = part.name ?? "unknown";
		const key = part.id ?? `assistant:${message.timestamp ?? "unknown"}:${index}:${toolName}`;
		const record: PendingToolCallRecord = {
			key,
			toolName,
		};
		if (typeof message.timestamp === "number") record.assistantTimestamp = message.timestamp;
		if (part.id) record.toolCallId = part.id;
		if ("arguments" in part) record.args = part.arguments;
		toolCalls.push(record);
	}
	pending.clear();
	for (const toolCall of toolCalls) pending.set(toolCall.key, toolCall);
}

function applyToolExecutionStart(pending: Map<string, PendingToolCallRecord>, marker: ToolExecutionStartData): void {
	const existing = pending.get(marker.toolCallId);
	if (existing) {
		existing.startedAt = marker.startedAt;
		// The assistant message carries the full arguments; the marker only has
		// the command/path projection. Keep the richer copy when present.
		existing.args ??= marker.args;
		if (marker.intent) existing.intent = marker.intent;
		return;
	}
	const record: PendingToolCallRecord = {
		key: marker.toolCallId,
		toolCallId: marker.toolCallId,
		toolName: marker.toolName,
		args: marker.args,
		startedAt: marker.startedAt,
	};
	if (marker.intent) record.intent = marker.intent;
	pending.set(marker.toolCallId, record);
}

function applyMessageEntry(pending: Map<string, PendingToolCallRecord>, message: AgentMessage): void {
	if (message.role === "toolResult") {
		const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
		if (toolCallId) pending.delete(toolCallId);
		return;
	}
	appendAssistantToolCalls(pending, message);
}

/** Finds tool calls left pending at the end of a session branch. */
export function collectPendingToolCalls(entries: readonly SessionEntry[]): PendingToolCallDiagnostic[] {
	const pending = new Map<string, PendingToolCallRecord>();
	for (const entry of entries) {
		if (entry.type === "message") {
			applyMessageEntry(pending, entry.message);
			continue;
		}
		const marker = readToolExecutionStart(entry);
		if (marker) applyToolExecutionStart(pending, marker);
	}
	return [...pending.values()].map(({ key: _key, ...toolCall }) => toolCall);
}

function appendArgumentSummary(parts: string[], args: unknown): void {
	if (!isObject(args)) return;
	const command = args.command;
	if (typeof command === "string" && command.length > 0) {
		parts.push(`command \`${command}\``);
		return;
	}
	const path = args.path;
	if (typeof path === "string" && path.length > 0) parts.push(`path \`${path}\``);
}

function formatPendingToolCall(call: PendingToolCallDiagnostic): string {
	const parts = [call.toolName];
	if (call.toolCallId) parts.push(call.toolCallId);
	appendArgumentSummary(parts, call.args);
	return parts.join(" ");
}

/** Builds the resume warning shown when a prior branch ended mid-tool-call. */
export function describePendingToolCalls(entries: readonly SessionEntry[]): string | undefined {
	const pending = collectPendingToolCalls(entries);
	if (pending.length === 0) return undefined;
	const formatted = pending.map(formatPendingToolCall).join(", ");
	const noun = pending.length === 1 ? "tool call" : "tool calls";
	return `Previous session ended while ${pending.length} ${noun} remained pending: ${formatted}. The prior OMP process exited before recording tool result(s).`;
}
