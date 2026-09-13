import { describe, expect, it } from "bun:test";
import type { AdvisorSeverity } from "../../src/advisor/advise-tool";
import {
	AdvisorSeverityRateCap,
	DEFAULT_ADVISOR_BLOCKER_TURN_CAP,
	resolveAdvisorBlockerTurnCap,
} from "../../src/advisor/severity-rate-cap";

describe("resolveAdvisorBlockerTurnCap", () => {
	it("defaults to a one-blocker-per-turn budget when the config field is omitted", () => {
		expect(DEFAULT_ADVISOR_BLOCKER_TURN_CAP).toBe(1);
		expect(resolveAdvisorBlockerTurnCap(undefined)).toBe(1);
	});

	it("treats an explicit null as an uncapped advisor (pre-cap behavior)", () => {
		expect(resolveAdvisorBlockerTurnCap(null)).toBe(Number.POSITIVE_INFINITY);
	});

	it("honors a finite budget of one or more blockers per turn", () => {
		expect(resolveAdvisorBlockerTurnCap(1)).toBe(1);
		expect(resolveAdvisorBlockerTurnCap(3)).toBe(3);
		expect(resolveAdvisorBlockerTurnCap(2.9)).toBe(2);
	});

	it("falls back to the safe default on values that would zero out or disable the cap", () => {
		expect(resolveAdvisorBlockerTurnCap(0)).toBe(1);
		expect(resolveAdvisorBlockerTurnCap(-2)).toBe(1);
		expect(resolveAdvisorBlockerTurnCap(Number.NaN)).toBe(1);
		expect(resolveAdvisorBlockerTurnCap(Number.POSITIVE_INFINITY)).toBe(1);
	});
});

describe("AdvisorSeverityRateCap", () => {
	it("admits the first blocker of a turn and downgrades every further blocker to concern", () => {
		const cap = new AdvisorSeverityRateCap();
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("concern");
		expect(cap.admit("blocker")).toBe("concern");
		expect(cap.remainingBlockers).toBe(0);
	});

	it("never touches non-blocker severities or consumes their budget", () => {
		const cap = new AdvisorSeverityRateCap();
		expect(cap.admit("nit")).toBe("nit");
		expect(cap.admit("concern")).toBe("concern");
		expect(cap.admit(undefined)).toBeUndefined();
		expect(cap.remainingBlockers).toBe(1);
		// A blocker arriving after a stream of nits/concerns still gets the full label.
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("concern");
	});

	it("restores the blocker budget on each new primary turn", () => {
		const cap = new AdvisorSeverityRateCap();
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("concern");

		cap.beginTurn();
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("concern");
	});

	it("drops all budget state on reset, matching the conversation boundary", () => {
		const cap = new AdvisorSeverityRateCap();
		expect(cap.admit("blocker")).toBe("blocker");
		cap.reset();
		expect(cap.remainingBlockers).toBe(1);
		expect(cap.admit("blocker")).toBe("blocker");
	});

	it("honors a raised budget before downgrading", () => {
		const cap = new AdvisorSeverityRateCap(resolveAdvisorBlockerTurnCap(3));
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("concern");
	});

	it("never downgrades when configured as uncapped via null", () => {
		const cap = new AdvisorSeverityRateCap(resolveAdvisorBlockerTurnCap(null));
		const severities: AdvisorSeverity[] = ["blocker", "blocker", "blocker"];
		for (const severity of severities) expect(cap.admit(severity)).toBe("blocker");
	});

	it("keeps a zero-budget config at the safe default rather than silencing blockers", () => {
		const cap = new AdvisorSeverityRateCap(resolveAdvisorBlockerTurnCap(0));
		expect(cap.admit("blocker")).toBe("blocker");
		expect(cap.admit("blocker")).toBe("concern");
	});
});
