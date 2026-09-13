import { afterEach, describe, expect, it, vi } from "bun:test";
import { Effort, type Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";
import { ModelControls, type ModelControlsHost } from "@oh-my-pi/pi-coding-agent/session/model-controls";
import { AUTO_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { tinyModelClient } from "@oh-my-pi/pi-coding-agent/tiny/title-client";

/**
 * EF2-R3: separate configured auto policy, auto baseline, and temporary
 * next-request override — exercised on ModelControls directly.
 *
 * The override is a first-party proposal (from the thinking_effort tool) that
 * applies to ONE main logical request and expires afterwards, without ever
 * leaving configured=auto or disabling classification for later turns.
 */

const FULL_LADDER = [Effort.Low, Effort.Medium, Effort.High, Effort.XHigh, Effort.Max];

function ladderModel(efforts: Effort[], id = "mock-ladder"): Model {
	return buildModel({
		id,
		name: id,
		api: "openai-completions",
		provider: "mock",
		baseUrl: "https://example.com",
		reasoning: true,
		thinking: { mode: "effort", efforts },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	});
}

interface FixtureOptions {
	adaptive?: boolean;
	ultrathink?: boolean;
	promptGeneration?: number;
	ceiling?: Effort;
}

function createFixture(options: FixtureOptions = {}) {
	const model = ladderModel(FULL_LADDER);
	const events: AgentSessionEvent[] = [];
	let currentModel: Model | undefined = model;
	let generation = options.promptGeneration ?? 1;
	const agentSpies = { setThinkingLevel: vi.fn(), setDisableReasoning: vi.fn() };
	const host = {
		agent: agentSpies,
		settings: Settings.isolated({
			"providers.autoThinkingAdaptive": options.adaptive ?? true,
			"providers.autoThinkingModel": "qwen3-1.7b",
		}),
		modelRegistry: { authStorage: undefined },
		sessionManager: { appendThinkingLevelChange: vi.fn() },
		providerSessionState: new Map(),
		model: () => currentModel,
		sessionId: () => "session-under-test",
		promptGeneration: () => generation,
		syncAfterModelChange: async () => {},
		setModelWithProviderSessionReset: async () => {},
		clearActiveRetryFallback: () => {},
		clearInheritedProviderPromptCacheKey: () => {},
		magicKeywordEnabled: (keyword: "orchestrate" | "ultrathink" | "workflow") =>
			keyword === "ultrathink" && (options.ultrathink ?? false),
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
		setModel: (next: Model | undefined) => {
			currentModel = next;
		},
		setGeneration: (next: number) => {
			generation = next;
		},
	};
}

function lastReceipt(events: AgentSessionEvent[]): Record<string, unknown> {
	const decisions = events.filter(event => event.type === "auto_thinking_decision");
	const last = decisions.at(-1);
	if (last?.type !== "auto_thinking_decision") throw new Error("No decision receipt emitted");
	return JSON.parse(JSON.stringify(last.receipt)) as Record<string, unknown>;
}

function receipts(events: AgentSessionEvent[]): Array<Record<string, unknown>> {
	return events
		.filter(
			(event): event is Extract<AgentSessionEvent, { type: "auto_thinking_decision" }> =>
				event.type === "auto_thinking_decision",
		)
		.map(event => JSON.parse(JSON.stringify(event.receipt)) as Record<string, unknown>);
}

/** Auto on + classifier-resolved baseline (avoids the singleton fast path via the full ladder). */
async function autoWithBaselineLow(options: FixtureOptions = {}) {
	const fixture = createFixture(options);
	controlsEnterAuto(fixture.controls);
	vi.spyOn(tinyModelClient, "complete").mockResolvedValue("trivial");
	await fixture.controls.applyAutoThinkingLevel("do the thing", 1);
	vi.restoreAllMocks();
	expect(fixture.controls.thinkingLevel).toBe(Effort.Low);
	expect(fixture.controls.isAutoThinking).toBe(true);
	return fixture;
}

function controlsEnterAuto(controls: ModelControls): void {
	controls.setThinkingLevel(AUTO_THINKING);
}

describe("ModelControls next-request override (EF2-R3)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps configured auto, baseline, and the temporary override as separate state", async () => {
		const { controls } = await autoWithBaselineLow();

		const beforeProposal = controls.thinkingLevel;
		const result = controls.proposeRequestOverride("high", 1);

		expect(result.accepted).toBe(true);
		if (result.accepted) expect(result.effort).toBe(Effort.High);
		// The proposal is temporary state only: configured stays auto and the
		// effective baseline level is untouched until actual dispatch.
		expect(controls.isAutoThinking).toBe(true);
		expect(controls.configuredThinkingLevel()).toBe(AUTO_THINKING);
		expect(controls.thinkingLevel).toBe(beforeProposal);
		expect(controls.pendingRequestOverride?.effort).toBe(Effort.High);
		expect(controls.hasRequestOverride).toBe(true);
	});

	it("rejects proposals when adaptive mode is off", async () => {
		const { controls } = await autoWithBaselineLow({ adaptive: false });

		const result = controls.proposeRequestOverride("high", 1);

		expect(result.accepted).toBe(false);
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("rejects proposals when a manual concrete pin disabled auto", () => {
		const { controls } = createFixture({ adaptive: true });
		controls.setThinkingLevel(Effort.Medium);

		const result = controls.proposeRequestOverride("high", 1);

		expect(result.accepted).toBe(false);
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("cancels a pending override when the user pins a concrete level", async () => {
		const { controls } = await autoWithBaselineLow();
		expect(controls.proposeRequestOverride("high", 1).accepted).toBe(true);

		controls.setThinkingLevel(Effort.Medium);

		expect(controls.hasRequestOverride).toBe(false);
		expect(controls.isAutoThinking).toBe(false);
		expect(controls.thinkingLevel).toBe(Effort.Medium);
	});

	it("rejects unsupported efforts for the active model", async () => {
		const { controls, setModel } = await autoWithBaselineLow();
		setModel(ladderModel([Effort.Low, Effort.Medium], "mock-small"));

		const result = controls.proposeRequestOverride("xhigh", 1);

		expect(result.accepted).toBe(false);
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("rejects unknown effort strings", async () => {
		const { controls } = await autoWithBaselineLow();

		const result = controls.proposeRequestOverride("colossal", 1);

		expect(result.accepted).toBe(false);
	});

	it("rejects no-op proposals that match the current effective level", async () => {
		const { controls } = await autoWithBaselineLow();

		const result = controls.proposeRequestOverride("low", 1);

		expect(result.accepted).toBe(false);
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("accepts a proposal above the hard ceiling clamped down to the ceiling", async () => {
		const { controls } = await autoWithBaselineLow({ ceiling: Effort.High });

		const result = controls.proposeRequestOverride("max", 1);

		expect(result.accepted).toBe(true);
		if (result.accepted) {
			expect(result.effort).toBe(Effort.High);
			expect(result.clampedToCeiling).toBe(true);
		}
		expect(controls.pendingRequestOverride?.effort).toBe(Effort.High);
	});

	it("arbitrates conflicting proposals last-wins", async () => {
		const { controls } = await autoWithBaselineLow();

		const first = controls.proposeRequestOverride("high", 1);
		const second = controls.proposeRequestOverride("medium", 1);

		expect(first.accepted).toBe(true);
		expect(second.accepted).toBe(true);
		expect(controls.pendingRequestOverride?.effort).toBe(Effort.Medium);
	});

	it("consumes at dispatch: applies the temporary effort with a receipt and keeps auto configured", async () => {
		const { controls, events, agentSpies } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);

		const applied = controls.consumeRequestOverride("keep going");

		expect(applied).toBe(Effort.High);
		expect(controls.thinkingLevel).toBe(Effort.High);
		expect(controls.configuredThinkingLevel()).toBe(AUTO_THINKING);
		expect(controls.pendingRequestOverride).toBeUndefined();
		expect(agentSpies.setThinkingLevel).toHaveBeenCalledWith("high");
		const receipt = lastReceipt(events);
		expect(receipt.source).toBe("override");
		expect(receipt.classifierRequests).toBe(0);
		expect(receipt.previous).toBe(Effort.Low);
		expect(receipt.applied).toBe(Effort.High);
		const changed = events.filter(event => event.type === "thinking_level_changed").at(-1);
		if (changed?.type !== "thinking_level_changed") throw new Error("expected thinking_level_changed");
		expect(changed.configured).toBe(AUTO_THINKING);
		expect(changed.resolved).toBe(Effort.High);
	});

	it("drops a stale proposal whose generation moved before dispatch", async () => {
		const { controls, setGeneration } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);
		setGeneration(2);

		const applied = controls.consumeRequestOverride("a newer prompt");

		expect(applied).toBeUndefined();
		expect(controls.hasRequestOverride).toBe(false);
		expect(controls.thinkingLevel).toBe(Effort.Low);
	});

	it("drops the proposal when the next prompt explicitly ultrathinks", async () => {
		const { controls } = await autoWithBaselineLow({ ultrathink: true });
		controls.proposeRequestOverride("low", 1);

		const applied = controls.consumeRequestOverride("ultrathink the migration plan");

		expect(applied).toBeUndefined();
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("expires after the request: restores the baseline and emits an override-expired receipt", async () => {
		const { controls, events, agentSpies } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);
		expect(controls.consumeRequestOverride(undefined)).toBe(Effort.High);
		agentSpies.setThinkingLevel.mockClear();

		controls.expireRequestOverride({});

		expect(controls.thinkingLevel).toBe(Effort.Low);
		expect(controls.hasRequestOverride).toBe(false);
		expect(controls.isAutoThinking).toBe(true);
		expect(agentSpies.setThinkingLevel).toHaveBeenCalledWith("low");
		const receipt = lastReceipt(events);
		expect(receipt.source).toBe("override-expired");
		expect(receipt.classifierRequests).toBe(0);
		expect(receipt.previous).toBe(Effort.High);
		expect(receipt.applied).toBe(Effort.Low);
	});

	it("keeps the override across a retryable failure and expires on real settle", async () => {
		const { controls } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);
		controls.consumeRequestOverride(undefined);

		controls.expireRequestOverride({ retryableFailure: true });
		expect(controls.thinkingLevel).toBe(Effort.High);
		expect(controls.hasRequestOverride).toBe(true);

		controls.expireRequestOverride({});
		expect(controls.thinkingLevel).toBe(Effort.Low);
	});

	it("revalidates a consumed override against a fallback model without it", async () => {
		const { controls, setModel } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);
		expect(controls.consumeRequestOverride(undefined)).toBe(Effort.High);
		// R1 fallback switched to a model whose ladder cannot express `high`.
		setModel(ladderModel([Effort.Low, Effort.Medium], "mock-fallback"));

		const applied = controls.consumeRequestOverride(undefined);

		expect(applied).toBeUndefined();
		expect(controls.thinkingLevel).toBe(Effort.Low);
		expect(controls.hasRequestOverride).toBe(false);
	});

	it("drops the pending override when the proposing request aborted", async () => {
		const { controls } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);

		controls.expireRequestOverride({ aborted: true });

		expect(controls.hasRequestOverride).toBe(false);
		expect(controls.thinkingLevel).toBe(Effort.Low);
	});

	it("suppresses a proposal equal to the currently applied override", async () => {
		const { controls } = await autoWithBaselineLow();
		controls.proposeRequestOverride("high", 1);
		controls.consumeRequestOverride(undefined);

		const result = controls.proposeRequestOverride("high", 1);

		expect(result.accepted).toBe(false);
		// A different level while armed is accepted as pending for the next
		// request but must not change the in-flight effective level.
		const escalation = controls.proposeRequestOverride("max", 1);
		expect(escalation.accepted).toBe(true);
		expect(controls.thinkingLevel).toBe(Effort.High);
		expect(controls.pendingRequestOverride?.effort).toBe(Effort.Max);
	});

	it("records zero classifier requests across the full override lifecycle", async () => {
		const { controls, events } = await autoWithBaselineLow();
		const complete = vi.spyOn(tinyModelClient, "complete");

		controls.proposeRequestOverride("high", 1);
		controls.consumeRequestOverride("next turn");
		controls.expireRequestOverride({});

		expect(complete).not.toHaveBeenCalled();
		const overrideReceipts = receipts(events).filter(
			receipt => receipt.source === "override" || receipt.source === "override-expired",
		);
		expect(overrideReceipts).toHaveLength(2);
		expect(overrideReceipts.every(receipt => receipt.classifierRequests === 0)).toBe(true);
	});
});
