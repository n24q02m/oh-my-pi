import type { ResolvedThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Effort } from "@oh-my-pi/pi-ai";

/**
 * Why `auto` resolved the way it did for one prompt (EF1.4 decision receipt).
 *
 * - `ultrathink` — explicit keyword bypassed the classifier.
 * - `singleton` — EF1.3 fast path: every eligible outcome collapsed to one
 *   effort, so no classifier request was made.
 * - `classifier` — the online/local classifier produced the candidate.
 * - `fallback` — the classifier failed (or timed out) and the prior/provisional
 *   level was kept.
 * - `aborted` — the turn was superseded/aborted before the decision applied;
 *   nothing was persisted or emitted downstream.
 */
export type AutoThinkingDecisionSource = "ultrathink" | "singleton" | "classifier" | "fallback" | "aborted";

/**
 * How the decided model's thinking capability was established. Only catalog
 * inference exists today; EF1-R2's endpoint capability override adds the
 * `override` member when it lands.
 */
export type AutoThinkingCapabilityStrategy = "inferred" | "override";

/**
 * One auto-thinking decision, recorded per prompt generation.
 *
 * Redaction is by construction: the type has no field that could carry the
 * prompt text, private reasoning, provider request/response bodies, token
 * counts, or account/credential identities. `failure` is a bounded
 * error-message string (no stack, no provider payload). `modelId`/
 * `provider` identify the configured model selector, not a credential.
 */
export interface AutoThinkingDecisionReceipt {
	/** Prompt generation the decision belongs to (correlates with abort checks). */
	generation: number;
	provider: string;
	modelId: string;
	source: AutoThinkingDecisionSource;
	/** Session thinking level before this decision (undefined = unset). */
	previous: ResolvedThinkingLevel | undefined;
	/** Raw classifier/singleton outcome before the session-ceiling clamp. */
	candidate: Effort | undefined;
	/** Level applied to the session; undefined for `aborted` (no change). */
	applied: Effort | undefined;
	/** How the model's thinking capability was established for this decision. */
	capabilityStrategy: AutoThinkingCapabilityStrategy;
	/** Wall time from decision start to resolution (or abandonment). */
	durationMs: number;
	/** 1 when a classifier request was made, 0 for all other sources. */
	classifierRequests: 0 | 1;
	/** Bounded error message when the classifier failed; never a stack/payload. */
	failure?: string | undefined;
}

/** Hard cap for `failure` — enough for any thrown `Error.message`, never a body. */
const MAX_FAILURE_LENGTH = 200;

export function autoThinkingDecisionReceipt(
	receipt: Omit<AutoThinkingDecisionReceipt, "failure"> & { failure?: string },
): AutoThinkingDecisionReceipt {
	const { failure } = receipt;
	if (failure === undefined) return receipt;
	return { ...receipt, failure: failure.slice(0, MAX_FAILURE_LENGTH) };
}

/**
 * Distinct cache evidence for EF1.4: "cache drop observed" is a separate fact
 * from "cause established". A transition from provable cache reads to zero
 * reads is only attributed to an effort change when a thinking-level change
 * happened AFTER the last sample that still read from cache; otherwise the
 * drop stays `unestablished` (implicit zero-read noise, e.g. provider routing
 * changes), and callers must not merge the two.
 */
export type PromptCacheDropCause = "effort_change" | "unestablished";

export interface PromptCacheSample {
	/** `usage.cacheRead` of the completed request. */
	cacheReadTokens: number;
	/** Completion time (ms epoch). */
	atMs: number;
}

export interface PromptCacheDrop {
	provider: string;
	modelId: string;
	/** Cache-read tokens of the last sample that still hit cache. */
	previousCacheReadTokens: number;
	cause: PromptCacheDropCause;
}

/**
 * Pure transition detector: feed consecutive per-model usage samples in
 * completion order. Returns a drop only when the previous sample PROVED a
 * cache read and the new sample read zero — single-sided zeros are noise, not
 * drops, so no event is produced until a warm sample is observed first.
 */
export function detectPromptCacheDrop(
	provider: string,
	modelId: string,
	previous: PromptCacheSample | undefined,
	next: PromptCacheSample,
	lastEffortChangeAtMs: number | undefined,
): PromptCacheDrop | undefined {
	if (!previous || previous.cacheReadTokens <= 0 || next.cacheReadTokens > 0) return undefined;
	const cause: PromptCacheDropCause =
		lastEffortChangeAtMs !== undefined && lastEffortChangeAtMs > previous.atMs && lastEffortChangeAtMs <= next.atMs
			? "effort_change"
			: "unestablished";
	return { provider, modelId, previousCacheReadTokens: previous.cacheReadTokens, cause };
}
