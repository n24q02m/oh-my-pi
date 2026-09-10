import { afterEach, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";
import { ModelControls, type ModelControlsHost } from "@oh-my-pi/pi-coding-agent/session/model-controls";
import { AUTO_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { tinyModelClient } from "@oh-my-pi/pi-coding-agent/tiny/title-client";

describe("model controls auto thinking decision receipts", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function createFixture(options: { ultrathink?: boolean; promptGeneration?: number; settings?: Settings } = {}) {
		const model = getBundledModel("anthropic", "claude-sonnet-4-6");
		if (!model) throw new Error("Expected bundled Claude Sonnet 4.6 model");
		const events: AgentSessionEvent[] = [];
		const host = {
			agent: { setThinkingLevel: vi.fn(), setDisableReasoning: vi.fn() },
			settings: options.settings ?? Settings.isolated({}),
			modelRegistry: { authStorage: undefined },
			sessionManager: { appendThinkingLevelChange: vi.fn() },
			providerSessionState: new Map(),
			model: () => model,
			sessionId: () => "session-under-test",
			promptGeneration: () => options.promptGeneration ?? 1,
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
		return { controls: new ModelControls(host, {}), events };
	}

	function decisionReceipt(events: AgentSessionEvent[]): Record<string, unknown> {
		const decision = events.find(event => event.type === "auto_thinking_decision");
		if (decision?.type !== "auto_thinking_decision") throw new Error("No decision receipt emitted");
		return JSON.parse(JSON.stringify(decision.receipt)) as Record<string, unknown>;
	}

	it("ultrathink bypasses the classifier and emits a redacted receipt", async () => {
		const complete = vi.spyOn(tinyModelClient, "complete");
		const { controls, events } = createFixture({ ultrathink: true });
		controls.setThinkingLevel(AUTO_THINKING);

		await controls.applyAutoThinkingLevel("please ultrathink the migration plan MARKER-XYZ", 1);

		const receipt = decisionReceipt(events);
		expect(receipt.source).toBe("ultrathink");
		expect(receipt.classifierRequests).toBe(0);
		expect(receipt.applied).toBeDefined();
		expect(receipt.candidate).toBe(receipt.applied);
		expect(JSON.stringify(receipt)).not.toContain("MARKER-XYZ");
		expect(JSON.stringify(receipt)).not.toContain("migration plan");
		expect(complete).not.toHaveBeenCalled();
	});

	it("classifier path records one request and the resolved receipt", async () => {
		vi.spyOn(tinyModelClient, "complete").mockResolvedValue("trivial");
		const { controls, events } = createFixture({
			settings: Settings.isolated({ "providers.autoThinkingModel": "qwen3-1.7b" }),
		});
		controls.setThinkingLevel(AUTO_THINKING);

		await controls.applyAutoThinkingLevel("refactor the ingest pipeline", 1);

		const receipt = decisionReceipt(events);
		expect(receipt.source).toBe("classifier");
		expect(receipt.classifierRequests).toBe(1);
		expect(receipt.candidate).toBe("low");
		expect(receipt.applied).toBe("low");
		expect(receipt.previous).toBeDefined();
		expect(receipt.failure).toBeUndefined();
		expect(controls.lastAutoThinkingChangeAtMs()).toBeGreaterThan(0);
	});

	it("classifier failure falls back and keeps a bounded failure message", async () => {
		const { controls, events } = createFixture();
		controls.setThinkingLevel(AUTO_THINKING);

		await controls.applyAutoThinkingLevel("do the thing", 1);

		const receipt = decisionReceipt(events);
		expect(receipt.source).toBe("fallback");
		expect(receipt.classifierRequests).toBe(1);
		expect(receipt.applied).toBeDefined();
		const failure = receipt.failure as string;
		expect(typeof failure).toBe("string");
		expect(failure.length).toBeGreaterThan(0);
		expect(failure.length).toBeLessThanOrEqual(200);
	});

	it("stale generation emits an aborted receipt and applies nothing", async () => {
		const { controls, events } = createFixture({ promptGeneration: 99 });
		controls.setThinkingLevel(AUTO_THINKING);

		await controls.applyAutoThinkingLevel("stale prompt", 1);

		const receipt = decisionReceipt(events);
		expect(receipt.source).toBe("aborted");
		expect(receipt.applied).toBeUndefined();
		const resolvedEvents = events.filter(
			event => event.type === "thinking_level_changed" && event.resolved !== undefined,
		);
		expect(resolvedEvents).toHaveLength(0);
	});
});
