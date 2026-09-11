import type { AgentMessage } from "@oh-my-pi/pi-agent-core";

/**
 * EF2-R2 bounded task-context envelope for the auto-thinking classifier.
 *
 * The classifier's difficulty decision must reflect the *actual dispatched
 * batch* in service of the ongoing task, not just a short continuation like
 * "làm tiếp đi" or "vẫn lỗi". This module builds a deterministic, locally
 * extracted envelope: active task objective, last visible result, previous
 * effort plus the reassessment reason, and the current dispatched input.
 *
 * Budget: the entire envelope fits a fixed 4,000-character total. Overflow is
 * dropped per section with an explicit omission marker that counts toward the
 * bound, and every drop is reported in {@link TaskContextResult.omissions} so
 * callers can measure information loss. Content is preserved verbatim — no
 * title-oriented code stripping, no XML-block removal, no summarizer request;
 * diagnostic snippets (stack traces, log tails) survive truncation at both
 * ends. Tool/repo text is untrusted data: it is placed inside section tags and
 * never interpreted, restructured, or allowed to grow the budget.
 *
 * Lack of context is stated explicitly (`(unknown …)`) rather than fabricated.
 */

/** Total character budget for the full envelope, scaffolding included. */
export const TASK_CONTEXT_TOTAL_BUDGET = 4000;

/** A current input at least this long (trimmed) starts a new task epoch. */
export const NEW_TASK_INPUT_THRESHOLD = 200;

/** Per-section content caps before scaffolding; current-input absorbs the remainder. */
const OBJECTIVE_CAP = 900;
const RECENT_RESULT_CAP = 1100;
const PREVIOUS_EFFORT_CAP = 80;
/** Minimum content room guaranteed to current-input after other sections. */
const CURRENT_INPUT_FLOOR = 1200;

const ENVELOPE_OPEN = "<task-context>";
const ENVELOPE_CLOSE = "</task-context>";
const ENVELOPE_SCAFFOLD_RE = /^<task-context>[\s\S]*<\/task-context>$/;

export interface TaskContextInput {
	/** The dispatched batch text (ordered join) — always present. */
	currentInput: string;
	/** Active task objective; derived from the transcript when available. */
	objective?: string | undefined;
	/** Last visible assistant/tool result summary; omitted when none exists. */
	recentResult?: string | undefined;
	/** Previously applied concrete effort (e.g. "high"). */
	previousEffort?: string | undefined;
	/** Why classification re-runs (e.g. "queued-batch", "new-prompt"). */
	reassessmentReason?: string | undefined;
}

export interface TaskContextOmission {
	section: "objective" | "recent-result" | "current-input" | "previous-effort";
	charsDropped: number;
}

export interface TaskContextResult {
	/** Envelope text, guaranteed ≤ {@link TASK_CONTEXT_TOTAL_BUDGET} chars. */
	text: string;
	usedChars: number;
	totalBudget: number;
	/** Measurable per-section overflow, in emission order. */
	omissions: TaskContextOmission[];
	/** Sections actually present; missing context is observable. */
	sections: TaskContextSection[];
	/** True when the current input superseded the objective (new task). */
	newTask: boolean;
}

export type TaskContextSection = "objective" | "recent-result" | "previous-effort" | "current-input";

/**
 * Middle-truncate one section to `cap` characters, keeping head + tail with an
 * explicit marker that counts toward the cap. Deterministic; the two-pass
 * marker-width convergence mirrors `truncateTinyMessage`.
 */
function truncateSection(content: string, cap: number): { text: string; dropped: number } {
	if (content.length <= cap) return { text: content, dropped: 0 };
	let omitted = content.length - cap;
	let marker = "";
	let headChars = 0;
	let tailChars = 0;
	for (let pass = 0; pass < 2; pass++) {
		marker = `\n[… ${omitted} chars omitted …]\n`;
		const kept = Math.max(0, cap - marker.length);
		headChars = Math.ceil((kept * 2) / 3);
		tailChars = kept - headChars;
		omitted = content.length - headChars - tailChars;
	}
	marker = `\n[… ${omitted} chars omitted …]\n`;
	return { text: `${content.slice(0, headChars)}${marker}${content.slice(-tailChars)}`, dropped: omitted };
}

function section(tag: string, content: string): string {
	return `<${tag}>\n${content}\n</${tag}>`;
}

/**
 * Build the bounded task-context envelope. Deterministic for identical input;
 * total length is always ≤ {@link TASK_CONTEXT_TOTAL_BUDGET}.
 */
export function buildTaskContext(input: TaskContextInput): TaskContextResult {
	const omissions: TaskContextOmission[] = [];
	const sections: TaskContextSection[] = [];

	const trimmedInput = input.currentInput.trim();
	const newTask = trimmedInput.length >= NEW_TASK_INPUT_THRESHOLD;

	// Objective: the new task's input supersedes a stale objective; missing
	// context is an explicit conservative marker, never a fabricated summary.
	const objectiveRaw = newTask ? input.currentInput : (input.objective?.trim() || "(unknown — no prior task context)");

	const effortLine =
		input.previousEffort || input.reassessmentReason
			? `${input.previousEffort ?? "(unknown)"}${
					input.reassessmentReason ? ` (reassessment: ${input.reassessmentReason})` : ""
				}`
			: undefined;

	// Render the bounded head sections first, then hand current-input every
	// remaining character of the total budget, so the assembled envelope fits
	// exactly by construction instead of by cap arithmetic.
	const objective = truncateSection(objectiveRaw, OBJECTIVE_CAP);
	if (objective.dropped > 0) omissions.push({ section: "objective", charsDropped: objective.dropped });
	sections.push("objective");
	const objectivePart = section("objective", objective.text);

	let recentPart: string | undefined;
	if (input.recentResult !== undefined && input.recentResult.trim().length > 0) {
		const recent = truncateSection(input.recentResult, RECENT_RESULT_CAP);
		if (recent.dropped > 0) omissions.push({ section: "recent-result", charsDropped: recent.dropped });
		sections.push("recent-result");
		recentPart = section("recent-result", recent.text);
	}

	let effortPart: string | undefined;
	if (effortLine !== undefined) {
		const effort = truncateSection(effortLine, PREVIOUS_EFFORT_CAP);
		if (effort.dropped > 0) omissions.push({ section: "previous-effort", charsDropped: effort.dropped });
		sections.push("previous-effort");
		effortPart = section("previous-effort", effort.text);
	}

	const separators = 1 + (recentPart !== undefined ? 1 : 0) + (effortPart !== undefined ? 1 : 0);
	const usedBeforeInput =
		ENVELOPE_OPEN.length +
		1 +
		objectivePart.length +
		(recentPart?.length ?? 0) +
		(effortPart?.length ?? 0) +
		separators +
		1 +
		CURRENT_INPUT_SCAFFOLD_LENGTH +
		ENVELOPE_CLOSE.length;
	const currentInputCap = Math.max(CURRENT_INPUT_FLOOR, TASK_CONTEXT_TOTAL_BUDGET - usedBeforeInput);

	const current = truncateSection(input.currentInput, currentInputCap);
	if (current.dropped > 0) omissions.push({ section: "current-input", charsDropped: current.dropped });
	sections.push("current-input");

	const parts = [objectivePart, recentPart, effortPart, section("current-input", current.text)].filter(
		(part): part is string => part !== undefined,
	);
	const text = `${ENVELOPE_OPEN}\n${parts.join("\n")}\n${ENVELOPE_CLOSE}`;
	return {
		text,
		usedChars: text.length,
		totalBudget: TASK_CONTEXT_TOTAL_BUDGET,
		omissions,
		sections,
		newTask,
	};
}

/**
 * True when `text` is a whole {@link buildTaskContext} envelope. Such text is
 * already bounded and must bypass the tiny-model cleanup pipeline (whose
 * paired-tag and code-block stripping would consume the envelope), mirroring
 * how preformatted title contexts bypass `preprocessTinyMessage`.
 */
export function isPreformattedTaskContext(text: string): boolean {
	return ENVELOPE_SCAFFOLD_RE.test(text.trim());
}

/** Join one reserved dispatch batch's message texts in dispatch order. */
export function buildDispatchBatchText(messages: readonly AgentMessage[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		const text = extractTextContent(message);
		if (text.length > 0) parts.push(text);
	}
	return parts.join("\n");
}

/** Extract plain text from one agent message's content (text blocks only). */
export function extractTextContent(message: AgentMessage): string {
	if (!("content" in message) || !Array.isArray(message.content)) return "";
	const parts: string[] = [];
	for (const block of message.content) {
		if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) {
			parts.push(String(block.text));
		}
	}
	return parts.join("\n");
}

/**
 * Deterministic active-task objective: the first user message of the current
 * transcript (the founding task). Undefined when the transcript has no user
 * turn — callers must surface that as missing context, not guess.
 */
export function extractTaskObjective(messages: readonly AgentMessage[]): string | undefined {
	for (const message of messages) {
		if (message.role === "user") {
			const text = extractTextContent(message).trim();
			if (text.length > 0) return text;
		}
	}
	return undefined;
}

/**
 * Deterministic recent visible result: the last assistant text or tool result,
 * scanning backwards. Undefined when only user turns exist.
 */
export function extractRecentResult(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === "assistant" || message.role === "toolResult") {
			const text = extractTextContent(message).trim();
			if (text.length > 0) return text;
		}
	}
	return undefined;
}

/** Tag + newline scaffolding around the current-input section's content. */
const CURRENT_INPUT_SCAFFOLD_LENGTH = "<current-input>\n\n</current-input>".length;
