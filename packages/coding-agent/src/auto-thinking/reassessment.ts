/**
 * EF2-R4 qualifying reassessment events.
 *
 * The adaptive controller may only spend its bounded transition budget on
 * evidence. A `ReassessmentSignal` is the structured outcome of one dispatched
 * logical request; {@link ReassessmentTracker} folds signals into verdicts:
 *
 * - Qualifying: comparable repeated failures, sustained no-progress, and task
 *   phase changes. These open a reassessment event the controller may act on.
 * - Negative controls: TDD expected failures, tool cancellations, harmless
 *   output changes, one-off failures, and steady progress. These look like
 *   events but must never trigger adaptation.
 *
 * Pure and deterministic: no clock, no I/O, no prompt text — signals carry a
 * caller-derived comparable key (tool + normalized signature), never raw
 * output, so trackers stay redaction-safe by construction.
 */

export type ReassessmentSignalKind =
	/** Request or tool failure; `comparableKey` groups comparable signatures. */
	| "error"
	/** Deadline exceeded; grouped like errors. */
	| "timeout"
	/** User- or system-initiated cancellation of the request/tool. */
	| "cancelled"
	/** Expected failing check (TDD red phase) — not a real failure. */
	| "expected-failure"
	/** The turn produced no observable state advance. */
	| "no-progress"
	/** The task moved to a new phase (objective/scope transition). */
	| "phase-change"
	/** Output changed without failing — churn, not progress evidence. */
	| "output-change"
	/** The turn made real progress or succeeded. */
	| "success";

export interface ReassessmentSignal {
	kind: ReassessmentSignalKind;
	/**
	 * Comparable signature for `error`/`timeout` (e.g. `"tool:bash:exit 1"`).
	 * Signals of other kinds ignore it. Must not carry prompts or raw bodies.
	 */
	comparableKey?: string;
	/** Explicit progress marker for `success`; defaults to true. */
	progressed?: boolean;
}

/** Why a qualifying reassessment event opened. */
export type ReassessmentReason = "repeated-failure" | "no-progress" | "phase-change";

/**
 * Why a signal is a negative control: evidence-shaped but never qualifying.
 * `isolated-failure` also covers not-yet-threshold no-progress observations.
 */
export type NegativeControlKind =
	| "expected-failure"
	| "tool-cancellation"
	| "harmless-output"
	| "isolated-failure"
	| "steady-progress";

export type ReassessmentVerdict =
	| { qualifying: true; reason: ReassessmentReason }
	| { qualifying: false; control: NegativeControlKind };

/** Comparable consecutive failures needed before a failure streak qualifies. */
export const REPEATED_FAILURE_THRESHOLD = 2;

/** Consecutive no-progress observations needed before no-progress qualifies. */
export const NO_PROGRESS_THRESHOLD = 3;

export class ReassessmentTracker {
	#failureKey: string | undefined;
	#failureCount = 0;
	#noProgressCount = 0;
	#open: ReassessmentReason | undefined;

	/** The open qualifying event, if any; one event per assessment decision. */
	peekOpen(): ReassessmentReason | undefined {
		return this.#open;
	}

	/** Takes the open qualifying event, clearing it. */
	consumeOpen(): ReassessmentReason | undefined {
		const open = this.#open;
		this.#open = undefined;
		return open;
	}

	/** Clears all streaks and the open event (fresh session/policy boundary). */
	reset(): void {
		this.#failureKey = undefined;
		this.#failureCount = 0;
		this.#noProgressCount = 0;
		this.#open = undefined;
	}

	observe(signal: ReassessmentSignal): ReassessmentVerdict {
		switch (signal.kind) {
			case "error":
			case "timeout": {
				const key = signal.comparableKey ?? signal.kind;
				if (this.#failureKey === key) {
					this.#failureCount += 1;
				} else {
					this.#failureKey = key;
					this.#failureCount = 1;
				}
				if (this.#failureCount >= REPEATED_FAILURE_THRESHOLD) {
					this.#open = "repeated-failure";
					return { qualifying: true, reason: "repeated-failure" };
				}
				return { qualifying: false, control: "isolated-failure" };
			}
			case "cancelled":
				// A cancellation interrupts the sequence: failures around it are no
				// longer comparable repeats.
				this.#failureKey = undefined;
				this.#failureCount = 0;
				return { qualifying: false, control: "tool-cancellation" };
			case "expected-failure":
				// A TDD red step is neither a comparable failure nor progress: the
				// surrounding real-failure streak stays intact.
				return { qualifying: false, control: "expected-failure" };
			case "no-progress": {
				this.#noProgressCount += 1;
				if (this.#noProgressCount >= NO_PROGRESS_THRESHOLD) {
					this.#open = "no-progress";
					return { qualifying: true, reason: "no-progress" };
				}
				return { qualifying: false, control: "isolated-failure" };
			}
			case "phase-change":
				this.#failureKey = undefined;
				this.#failureCount = 0;
				this.#noProgressCount = 0;
				this.#open = "phase-change";
				return { qualifying: true, reason: "phase-change" };
			case "output-change":
				// Harmless churn is evidence of nothing: no streak moves.
				return { qualifying: false, control: "harmless-output" };
			case "success":
				this.#failureKey = undefined;
				this.#failureCount = 0;
				this.#noProgressCount = 0;
				this.#open = undefined;
				return { qualifying: false, control: "steady-progress" };
		}
	}
}
