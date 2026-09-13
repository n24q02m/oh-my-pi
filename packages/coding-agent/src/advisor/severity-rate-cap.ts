import type { AdvisorSeverity } from "./advise-tool";

/**
 * Default per-turn blocker budget. Live evidence from a flash-tier advisor
 * session (`__advisor.jsonl`, 2026-09) recorded 44 delivered cards of which
 * 29 (66–69%) carried `severity="blocker"` — a small model treating every
 * observation as an emergency. Each blocker steers (and can trigger) a primary
 * turn, so mis-calibrated blockers thrash the run. Capping the blocker label at
 * one card per primary turn keeps the "the agent handed off broken work"
 * signal rare and load-bearing while excess notes still reach the primary at
 * a lower severity.
 */
export const DEFAULT_ADVISOR_BLOCKER_TURN_CAP = 1;

/**
 * Resolve the per-advisor `maxBlockersPerTurn` config value into the effective
 * per-turn blocker budget.
 *
 * - `undefined` → {@link DEFAULT_ADVISOR_BLOCKER_TURN_CAP} (the safe default:
 *   the cap is active without any configuration).
 * - `null` → unbounded, restoring the pre-cap behavior for advisors whose
 *   operator wants every blocker delivered verbatim.
 * - A finite integer ≥ 1 → that budget.
 * - Anything else (0, negative, NaN, infinite) → the safe default, so a
 *   nonsensical value can never silently disable or zero out the label.
 */
export function resolveAdvisorBlockerTurnCap(value: number | null | undefined): number {
	if (value === undefined) return DEFAULT_ADVISOR_BLOCKER_TURN_CAP;
	if (value === null) return Number.POSITIVE_INFINITY;
	if (!Number.isFinite(value) || value < 1) return DEFAULT_ADVISOR_BLOCKER_TURN_CAP;
	return Math.trunc(value);
}

/**
 * Per-advisor gate bounding how many `severity="blocker"` cards may reach the
 * primary per primary turn. Sits at the same `#routeAdvice` boundary as
 * {@link AdvisorEmissionGuard} (which has already dropped noise and exact
 * duplicates by the time the cap sees a note), but keys on severity instead of
 * text: the first blocker of a turn keeps its label and its steering semantics;
 * every further blocker in the same turn is delivered as `concern` instead.
 *
 * The downgrade is deliberately lossless — the note still reaches the primary
 * (concern is interrupting, and rides the ordinary delivery-channel logic
 * including the post-interrupt immune window) — but it can no longer force a
 * turn trigger at a terminal answer, the privilege that makes a flood of
 * mis-calibrated blockers so disruptive.
 *
 * The budget is per primary turn: `AdvisorSession` calls {@link beginTurn} on
 * every `turn_start`, and {@link reset} on the conversation boundary, matching
 * the reset discipline of `AdvisorEmissionGuard`. Non-blocker severities pass
 * through untouched and never consume budget.
 */
export class AdvisorSeverityRateCap {
	#deliveredBlockersThisTurn = 0;
	readonly #maxPerTurn: number;

	constructor(maxPerTurn: number = resolveAdvisorBlockerTurnCap(undefined)) {
		this.#maxPerTurn = maxPerTurn;
	}

	/** Open a fresh blocker budget. Called on every primary `turn_start`. */
	beginTurn(): void {
		this.#deliveredBlockersThisTurn = 0;
	}

	/** Drop all budget state. Called on the conversation boundary (`/new`, session switch). */
	reset(): void {
		this.#deliveredBlockersThisTurn = 0;
	}

	/** How many blocker cards this turn's budget still admits. Exposed for stats/tests. */
	get remainingBlockers(): number {
		return Math.max(0, this.#maxPerTurn - this.#deliveredBlockersThisTurn);
	}

	/**
	 * Admit one note at `severity`. Non-blockers return unchanged without
	 * touching the budget. A blocker inside budget consumes one unit and
	 * returns `"blocker"`; a blocker past budget returns `"concern"` — the
	 * caller delivers the note at the returned severity.
	 */
	admit(severity: AdvisorSeverity | undefined): AdvisorSeverity | undefined {
		if (severity !== "blocker") return severity;
		if (this.#deliveredBlockersThisTurn >= this.#maxPerTurn) return "concern";
		this.#deliveredBlockersThisTurn++;
		return "blocker";
	}
}
