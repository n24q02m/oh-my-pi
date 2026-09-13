import { afterEach, describe, expect, it, vi } from "bun:test";
import { Effort, type Model, THINKING_EFFORTS } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";
import { ModelControls, type ModelControlsHost } from "@oh-my-pi/pi-coding-agent/session/model-controls";
import { AUTO_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { tinyModelClient } from "@oh-my-pi/pi-coding-agent/tiny/title-client";

/**
 * EF2-R4/R5 bounded feedback on ModelControls:
 *
 * - a two-transition controller budget per user-dispatched interval, counting
 *   the override application and the automatic return, with the return slot
 *   reserved, retries free, and no stranded overrides at exhaustion;
 * - controller escalation only on qualifying reassessment events, never on
 *   negative controls;
 * - endpoint/API/model capability gating: unknown-conservative endpoints never
 *   enter the native override path, prefix-sensitive routes hold the baseline.
 */

const FULL_LADDER = [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, Effort.Max];

function ladderModel(
	efforts: Effort[],
	id = "mock-ladder",
	provider = "mock",
	baseUrl = "https://unit.example",
): Model {
	return buildModel({
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl,
		reasoning: true,
		thinking: { mode: "effort", efforts },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	});
}

function createFixture(options: { adaptive?: boolean; ceiling?: Effort } = {}) {
	const model = ladderModel(FULL_LADDER);
	const events: AgentSessionEvent[] = [];
	let currentModel: Model | undefined = model;
	let generation = 1;
	const agentSpies = { setThinkingLevel: vi.fn(), setDisableReasoning: vi.fn() };
	const sessionManager = {
		appendThinkingLevelChange: vi.fn(),
		appendCapabilityEpochChange: vi.fn(),
		appendModelChange: vi.fn(),
	};
	const host = {
		agent: agentSpies,
		settings: Settings.isolated({
			"providers.autoThinkingModel": "qwen3-1.7b",
			"providers.autoThinkingAdaptive": options.adaptive ?? true,
		}),
		modelRegistry: {
			authStorage: undefined,
			hasConfiguredAuth: () => true,
			refreshSelectedModelMetadata: async (model: Model) => model,
			clearSuppressedSelector: () => {},
		},
		sessionManager,
		providerSessionState: new Map(),
		model: () => currentModel,
		sessionId: () => "session-under-test",
		promptGeneration: () => generation,
		setModelWithProviderSessionReset: async () => {},
		clearActiveRetryFallback: () => {},
		clearInheritedProviderPromptCacheKey: () => {},
		resolveActiveEditMode: () => "tool" as const,
		syncAfterModelChange: async () => {},
		magicKeywordEnabled: () => false,
		emit: (event: AgentSessionEvent) => {
			events.push(event);
		},
		emitSessionEvent: async () => {},
		emitNotice: () => {},
	} as unknown as ModelControlsHost;
	const controls = new ModelControls(host, { thinkingLevelCeiling: options.ceiling });
	return {
		controls,
		events,
		agentSpies,
		sessionManager,
		setModel: (next: Model | undefined) => {
			currentModel = next;
		},
		setGeneration: (next: number) => {
			generation = next;
		},
	};
}

function receipts(events: AgentSessionEvent[]): Array<Record<string, unknown>> {
	return events
		.filter(
			(event): event is Extract<AgentSessionEvent, { type: "auto_thinking_decision" }> =>
				event.type === "auto_thinking_decision",
		)
		.map(event => JSON.parse(JSON.stringify(event.receipt)) as Record<string, unknown>);
}

function lastReceipt(events: AgentSessionEvent[]): Record<string, unknown> {
	const last = receipts(events).at(-1);
	if (!last) throw new Error("No decision receipt emitted");
	return last;
}

/** Auto on with a classifier-resolved low baseline (full ladder avoids the singleton fast path). */
async function autoWithBaselineLow(options: { adaptive?: boolean; ceiling?: Effort } = {}) {
	const fixture = createFixture(options);
	fixture.controls.setThinkingLevel(AUTO_THINKING);
	vi.spyOn(tinyModelClient, "complete").mockResolvedValue("trivial");
	await fixture.controls.applyAutoThinkingLevel("do the thing", 1);
	vi.restoreAllMocks();
	expect(fixture.controls.thinkingLevel).toBe(Effort.Low);
	return fixture;
}

/** One full apply+return override lifecycle from a tool proposal. */
function runLifecycle(controls: ModelControls, requested: Effort): void {
	expect(controls.proposeRequestOverride(requested, 1).accepted).toBe(true);
	expect(controls.consumeRequestOverride("dispatch")).toBeDefined();
	controls.expireRequestOverride({});
}

describe("ModelControls controller transition budget (EF2-R4)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("bounds the lifecycle to two transitions per interval and declines the second one", async () => {
		const { controls, events } = await autoWithBaselineLow();

		runLifecycle(controls, Effort.High);
		expect(controls.thinkingLevel).toBe(Effort.Low);

		// The interval's budget is spent: a second proposal may pend but its
		// consume must be declined instead of spending a third transition.
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);
		expect(controls.consumeRequestOverride("again")).toBeUndefined();
		expect(controls.pendingRequestOverride).toBeUndefined();
		expect(controls.thinkingLevel).toBe(Effort.Low);
		const decline = lastReceipt(events);
		expect(decline.source).toBe("override-declined");
		expect(decline.declineReason).toContain("budget");
		expect(decline.classifierRequests).toBe(0);
	});

	it("refreshes the budget at the next user-dispatched batch", async () => {
		const { controls } = await autoWithBaselineLow();
		runLifecycle(controls, Effort.High);

		controls.beginUserControllerInterval();
		expect(controls.consumeRequestOverride(undefined)).toBeUndefined();
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);
		expect(controls.consumeRequestOverride("fresh batch")).toBe(Effort.High);
		controls.expireRequestOverride({});
		expect(controls.thinkingLevel).toBe(Effort.Low);
	});

	it("does not spend the budget again across retries of the same request", async () => {
		const { controls } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);
		expect(controls.consumeRequestOverride(undefined)).toBe(Effort.High);

		controls.expireRequestOverride({ retryableFailure: true });
		controls.expireRequestOverride({ retryableFailure: true });
		expect(controls.thinkingLevel).toBe(Effort.High);

		controls.expireRequestOverride({});
		expect(controls.thinkingLevel).toBe(Effort.Low);

		// Arm + retries + return = exactly the two allowed transitions.
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);
		expect(controls.consumeRequestOverride("still this interval")).toBeUndefined();
	});

	it("never strands a pending override when the budget is exhausted", async () => {
		const { controls } = await autoWithBaselineLow();
		runLifecycle(controls, Effort.High);
		expect(controls.proposeRequestOverride(Effort.Medium, 1).accepted).toBe(true);

		controls.beginUserControllerInterval();
		controls.expireRequestOverride({ aborted: true });
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("declines a same-interval escalation that pended while armed", async () => {
		const { controls } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);
		expect(controls.consumeRequestOverride(undefined)).toBe(Effort.High);
		expect(controls.proposeRequestOverride(Effort.Max, 1).accepted).toBe(true);

		controls.expireRequestOverride({});
		expect(controls.thinkingLevel).toBe(Effort.Low);
		expect(controls.consumeRequestOverride("same interval dispatch")).toBeUndefined();
		expect(controls.pendingRequestOverride).toBeUndefined();
	});

	it("same-effective proposals never spend the budget", async () => {
		const { controls } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride(Effort.Low, 1).accepted).toBe(false);

		runLifecycle(controls, Effort.High);
		// Only the high lifecycle spent: a fresh interval is not required for a
		// no-op rejection first, then a real proposal still has room in a new
		// interval.
		controls.beginUserControllerInterval();
		runLifecycle(controls, Effort.Medium);
		expect(controls.thinkingLevel).toBe(Effort.Low);
	});
});

describe("ModelControls controller escalation on reassessment (EF2-R4)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("escalates one ladder step on a qualifying repeated-failure event", async () => {
		const { controls, events } = await autoWithBaselineLow();
		expect(controls.recordReassessmentSignal({ kind: "error", comparableKey: "tool:bash:exit 1" }).qualifying).toBe(
			false,
		);
		expect(controls.recordReassessmentSignal({ kind: "error", comparableKey: "tool:bash:exit 1" })).toEqual({
			qualifying: true,
			reason: "repeated-failure",
		});

		const escalation = controls.proposeControllerEscalation();
		expect(escalation.accepted).toBe(true);
		if (escalation.accepted) {
			expect(escalation.effort).toBe(Effort.Medium);
			expect(escalation.strategy).toBe("native-verified");
		}
		expect(controls.pendingRequestOverride?.origin).toBe("controller");

		// One event, one assessment.
		expect(controls.proposeControllerEscalation().accepted).toBe(false);
		expect(controls.openReassessment).toBeUndefined();

		expect(controls.consumeRequestOverride("retry with more thinking")).toBe(Effort.Medium);
		controls.expireRequestOverride({});
		expect(controls.thinkingLevel).toBe(Effort.Low);
		const overrideReceipts = receipts(events).filter(receipt => receipt.source === "override");
		expect(overrideReceipts).toHaveLength(1);
		expect(overrideReceipts[0]?.origin).toBe("controller");
	});

	it("never escalates on negative controls", async () => {
		const { controls } = await autoWithBaselineLow();
		for (const signal of [
			{ kind: "cancelled" },
			{ kind: "expected-failure" },
			{ kind: "output-change" },
			{ kind: "success", progressed: true },
		] as const) {
			controls.recordReassessmentSignal(signal);
			expect(controls.proposeControllerEscalation()).toEqual({
				accepted: false,
				reason: "no qualifying reassessment event",
			});
		}
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("declines escalation at the top of the supported ladder", async () => {
		const { controls } = await autoWithBaselineLow({ ceiling: Effort.Max });
		// Push the baseline to the ceiling through ultrathink-less classification:
		// resolve manually via an override lifecycle to max, then stay there.
		expect(controls.proposeRequestOverride(Effort.Max, 1).accepted).toBe(true);
		expect(controls.consumeRequestOverride(undefined)).toBe(Effort.Max);
		controls.expireRequestOverride({ retryableFailure: true });

		controls.recordReassessmentSignal({ kind: "phase-change" });
		expect(controls.proposeControllerEscalation().accepted).toBe(false);
	});

	it("declines escalation on an unknown-conservative endpoint", async () => {
		const { controls, setModel } = await autoWithBaselineLow();
		setModel(ladderModel([Effort.High, Effort.Max], "glm-5.2", "astra", "https://astra.internal.example/v1"));

		controls.recordReassessmentSignal({ kind: "phase-change" });
		const escalation = controls.proposeControllerEscalation();
		expect(escalation.accepted).toBe(false);
		if (!escalation.accepted) expect(escalation.reason).toContain("unverified");
	});
});

describe("ModelControls capability-gated proposals (EF2-R5)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps nominal-alias endpoints out of the native override path", async () => {
		const astraGlm = ladderModel([Effort.High, Effort.Max], "glm-5.2", "astra", "https://astra.internal.example/v1");
		const { controls, setModel } = await autoWithBaselineLow();
		setModel(astraGlm);

		const result = controls.proposeRequestOverride(Effort.Max, 1);
		expect(result.accepted).toBe(false);
		if (!result.accepted) expect(result.reason).toContain("unverified");
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("declines low-value downgrades on prefix-sensitive routes but accepts escalations with cache risk", async () => {
		const { controls, setModel } = await autoWithBaselineLow();
		setModel(
			ladderModel(
				[Effort.Minimal, ...FULL_LADDER],
				"mock-fast",
				"fireworks",
				"https://api.fireworks.ai/inference/v1",
			),
		);

		const downgrade = controls.proposeRequestOverride(Effort.Minimal, 1);
		expect(downgrade.accepted).toBe(false);
		if (!downgrade.accepted) expect(downgrade.reason).toContain("prefix-sensitive");

		const escalation = controls.proposeRequestOverride(Effort.High, 1);
		expect(escalation.accepted).toBe(true);
		if (escalation.accepted) {
			expect(escalation.strategy).toBe("prefix-sensitive");
			expect(escalation.cacheRisk).toContain("baseline");
			expect(escalation.cacheRisk).toContain("baseline");
		}
	});

	it("stamps the live capability strategy on override and expiry receipts", async () => {
		const { controls, events } = await autoWithBaselineLow();
		runLifecycle(controls, Effort.High);

		const overrideReceipts = receipts(events).filter(
			receipt => receipt.source === "override" || receipt.source === "override-expired",
		);
		expect(overrideReceipts).toHaveLength(2);
		expect(overrideReceipts.every(receipt => receipt.capabilityStrategy === "native-verified")).toBe(true);
	});
});

describe("ModelControls capability epoch persistence (EF2-R5)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("drops a pending override when a model switch changes the capability epoch", async () => {
		const { controls, setModel, sessionManager } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);

		setModel(
			ladderModel(
				[Effort.Minimal, ...FULL_LADDER],
				"kimi-k3-fast",
				"fireworks",
				"https://api.fireworks.ai/inference/v1",
			),
		);
		await controls.setModel(
			ladderModel(
				[Effort.Minimal, ...FULL_LADDER],
				"kimi-k3-fast",
				"fireworks",
				"https://api.fireworks.ai/inference/v1",
			),
		);
		// native → prefix-sensitive is a genuine capability epoch: unproven
		// overrides are dropped and the epoch change is persisted.
		expect(sessionManager.appendCapabilityEpochChange).toHaveBeenCalledTimes(1);
		expect(controls.hasRequestOverride).toBe(false);
		expect(controls.capabilityEpoch).toBe("prefix-sensitive");

		setModel(ladderModel(FULL_LADDER, "mock-ladder-2"));
		await controls.setModel(ladderModel(FULL_LADDER, "mock-ladder-2"));
		expect(sessionManager.appendCapabilityEpochChange).toHaveBeenCalledTimes(2);
		expect(controls.capabilityEpoch).toBe("native-verified");
	});

	it("keeps a pending override across an epoch-preserving model switch", async () => {
		const { controls, setModel, sessionManager } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);

		setModel(ladderModel(FULL_LADDER, "mock-ladder-b"));
		await controls.setModel(ladderModel(FULL_LADDER, "mock-ladder-b"));
		expect(sessionManager.appendCapabilityEpochChange).not.toHaveBeenCalled();
		expect(controls.pendingRequestOverride?.effort).toBe(Effort.High);
	});

	it("reconstructs the epoch on transcript restore and never resurrects overrides", async () => {
		const { controls } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride(Effort.High, 1).accepted).toBe(true);

		controls.restoreThinkingLevel(AUTO_THINKING);
		expect(controls.hasRequestOverride).toBe(false);
		expect(controls.capabilityEpoch).toBe("native-verified");
	});
});

describe("budget ladder sanity", () => {
	it("keeps THINKING_EFFORTS ordered least to most intensive", () => {
		expect(THINKING_EFFORTS[0]).toBe(Effort.Minimal);
		expect(THINKING_EFFORTS.at(-1)).toBe(Effort.Max);
	});
});
