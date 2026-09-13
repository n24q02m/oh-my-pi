import { describe, expect, it } from "bun:test";
import {
	NO_PROGRESS_THRESHOLD,
	REPEATED_FAILURE_THRESHOLD,
	type ReassessmentSignal,
	ReassessmentTracker,
} from "@oh-my-pi/pi-coding-agent/auto-thinking/reassessment";

/**
 * EF2-R4 qualifying reassessment events. The tracker separates events that
 * justify controller reassessment (comparable repeated failures, sustained
 * no-progress, phase changes) from negative controls that look like events
 * but must not trigger adaptation (TDD expected failures, tool cancellation,
 * harmless output changes).
 */

function error(key: string): ReassessmentSignal {
	return { kind: "error", comparableKey: key };
}

describe("ReassessmentTracker qualifying events (EF2-R4)", () => {
	it("does not qualify a single comparable failure", () => {
		const tracker = new ReassessmentTracker();
		const verdict = tracker.observe(error("tool:build:TS2345"));
		expect(verdict).toEqual({ qualifying: false, control: "isolated-failure" });
		expect(tracker.peekOpen()).toBeUndefined();
	});

	it("qualifies two comparable consecutive failures as repeated-failure", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe(error("tool:build:TS2345"));
		const verdict = tracker.observe(error("tool:build:TS2345"));
		expect(verdict).toEqual({ qualifying: true, reason: "repeated-failure" });
		expect(tracker.peekOpen()).toBe("repeated-failure");
	});

	it("restarts the streak when the failure signature changes", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe(error("tool:build:TS2345"));
		const verdict = tracker.observe(error("tool:test:ECONNRESET"));
		expect(verdict).toEqual({ qualifying: false, control: "isolated-failure" });
		expect(tracker.peekOpen()).toBeUndefined();
	});

	it("a TDD expected failure between comparable failures does not mask the streak", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe(error("tool:test:auth spec"));
		expect(tracker.observe({ kind: "expected-failure" })).toEqual({
			qualifying: false,
			control: "expected-failure",
		});
		// The red-phase step is not progress and not a comparable failure: the
		// real failure streak around it stays intact.
		const verdict = tracker.observe(error("tool:test:auth spec"));
		expect(verdict).toEqual({ qualifying: true, reason: "repeated-failure" });
	});

	it("a cancellation breaks failure comparability and is a negative control", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe(error("tool:build:TS2345"));
		expect(tracker.observe({ kind: "cancelled" })).toEqual({
			qualifying: false,
			control: "tool-cancellation",
		});
		const verdict = tracker.observe(error("tool:build:TS2345"));
		expect(verdict).toEqual({ qualifying: false, control: "isolated-failure" });
	});

	it("classifies timeouts with the failure families and qualifies comparable repeats", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe({ kind: "timeout", comparableKey: "tool:bench:deadline" });
		const verdict = tracker.observe({ kind: "timeout", comparableKey: "tool:bench:deadline" });
		expect(verdict).toEqual({ qualifying: true, reason: "repeated-failure" });
	});

	it("qualifies sustained no-progress after the threshold and resets on progress", () => {
		const tracker = new ReassessmentTracker();
		for (let index = 1; index < NO_PROGRESS_THRESHOLD; index++) {
			const verdict = tracker.observe({ kind: "no-progress" });
			expect(verdict).toEqual({ qualifying: false, control: "isolated-failure" });
		}
		const verdict = tracker.observe({ kind: "no-progress" });
		expect(verdict).toEqual({ qualifying: true, reason: "no-progress" });

		// Progress clears the open event and both streaks.
		expect(tracker.observe({ kind: "success", progressed: true })).toEqual({
			qualifying: false,
			control: "steady-progress",
		});
		expect(tracker.peekOpen()).toBeUndefined();
		expect(tracker.observe({ kind: "no-progress" })).toEqual({
			qualifying: false,
			control: "isolated-failure",
		});
	});
	it("harmless output changes are a negative control and never qualify on their own", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe({ kind: "no-progress" });
		expect(tracker.observe({ kind: "output-change" })).toEqual({
			qualifying: false,
			control: "harmless-output",
		});
		const second = tracker.observe({ kind: "no-progress" });
		// The churn did not count as no-progress evidence: still isolated.
		expect(second).toEqual({ qualifying: false, control: "isolated-failure" });
		// ...but it also did not reset the accumulation: the next one crosses.
		expect(tracker.observe({ kind: "no-progress" })).toEqual({ qualifying: true, reason: "no-progress" });
		expect(NO_PROGRESS_THRESHOLD).toBe(3);
	});

	it("qualifies a phase change immediately and resets prior streaks", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe(error("tool:build:TS2345"));
		const verdict = tracker.observe({ kind: "phase-change" });
		expect(verdict).toEqual({ qualifying: true, reason: "phase-change" });
		// The failure streak did not survive the phase boundary.
		tracker.consumeOpen();
		expect(tracker.observe(error("tool:build:TS2345")).qualifying).toBe(false);
	});

	it("consumeOpen takes the open event exactly once", () => {
		const tracker = new ReassessmentTracker();
		expect(tracker.consumeOpen()).toBeUndefined();
		tracker.observe({ kind: "phase-change" });
		expect(tracker.consumeOpen()).toBe("phase-change");
		expect(tracker.consumeOpen()).toBeUndefined();
		expect(tracker.peekOpen()).toBeUndefined();
	});

	it("reset clears every streak and open event", () => {
		const tracker = new ReassessmentTracker();
		tracker.observe({ kind: "phase-change" });
		tracker.reset();
		expect(tracker.peekOpen()).toBeUndefined();
		expect(tracker.observe({ kind: "no-progress" }).qualifying).toBe(false);
		expect(REPEATED_FAILURE_THRESHOLD).toBe(2);
	});
});
