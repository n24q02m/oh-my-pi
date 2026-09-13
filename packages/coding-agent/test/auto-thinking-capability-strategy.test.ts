import { describe, expect, it } from "bun:test";
import { Effort, type Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { resolveEffortCapabilityStrategy } from "@oh-my-pi/pi-coding-agent/auto-thinking/capability-strategy";

/**
 * EF2-R5 effort capability strategy: classified per endpoint/API/model, never
 * from model-id lineage alone. Verified endpoints may update effort natively;
 * routes that encode effort in the request identity are prefix-sensitive; an
 * unverified endpoint serving a nominal family alias must stay conservative
 * instead of silently entering the native override path.
 */

function modelWith(overrides: {
	id?: string;
	provider?: string;
	api?: string;
	baseUrl?: string;
	efforts?: Effort[];
	reasoning?: boolean;
}): Model {
	return buildModel({
		id: overrides.id ?? "mock-ladder",
		name: overrides.id ?? "mock-ladder",
		api: overrides.api ?? "openai-completions",
		provider: overrides.provider ?? "mock",
		baseUrl: overrides.baseUrl ?? "https://unit.example",
		reasoning: overrides.reasoning ?? true,
		thinking: { mode: "effort", efforts: overrides.efforts ?? [Effort.Low, Effort.Medium, Effort.High] },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	});
}

describe("resolveEffortCapabilityStrategy (EF2-R5)", () => {
	it("classifies a catalog model on its verified first-party host as native", () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5") as Model;
		const capability = resolveEffortCapabilityStrategy(model);
		expect(capability.strategy).toBe("native-verified");
	});

	it("trusts a declared effort surface on an endpoint with no lineage claim", () => {
		const capability = resolveEffortCapabilityStrategy(modelWith({}));
		expect(capability.strategy).toBe("native-verified");
	});

	it("keeps a nominal GLM alias on an unverified custom endpoint out of the native path", () => {
		const capability = resolveEffortCapabilityStrategy(
			modelWith({
				provider: "astra",
				id: "glm-5.2",
				baseUrl: "https://astra.internal.example/v1",
				efforts: [Effort.High, Effort.Max],
			}),
		);
		expect(capability.strategy).toBe("unknown-conservative");
		expect(capability.reason).toContain("glm");
	});

	it("keeps a nominal Claude alias on an unverified custom endpoint conservative too", () => {
		const capability = resolveEffortCapabilityStrategy(
			modelWith({
				provider: "astra",
				id: "claude-sonnet-4-5",
				baseUrl: "https://astra.internal.example/v1",
			}),
		);
		expect(capability.strategy).toBe("unknown-conservative");
	});

	it("classifies GLM on its verified Z.ai host as native", () => {
		const capability = resolveEffortCapabilityStrategy(
			modelWith({
				provider: "zai",
				id: "glm-5.2",
				baseUrl: "https://api.z.ai/api/paas/v4",
				efforts: [Effort.High, Effort.Max],
			}),
		);
		expect(capability.strategy).toBe("native-verified");
	});

	it("classifies GLM behind a catalog-verified aggregator as native", () => {
		const capability = resolveEffortCapabilityStrategy(
			modelWith({
				provider: "openrouter",
				id: "z-ai/glm-5.2",
				api: "openrouter",
				baseUrl: "https://openrouter.ai/api/v1",
				efforts: [Effort.High, Effort.Max],
			}),
		);
		expect(capability.strategy).toBe("native-verified");
	});

	it("is conservative when the model exposes no controllable effort surface", () => {
		const capability = resolveEffortCapabilityStrategy(modelWith({ efforts: [], reasoning: false }));
		expect(capability.strategy).toBe("unknown-conservative");
		expect(resolveEffortCapabilityStrategy(undefined).strategy).toBe("unknown-conservative");
	});

	it("marks routes that encode effort in the model identity as prefix-sensitive", () => {
		expect(resolveEffortCapabilityStrategy(modelWith({ provider: "devin", id: "devin-task-high" })).strategy).toBe(
			"prefix-sensitive",
		);
		expect(
			resolveEffortCapabilityStrategy(
				modelWith({ provider: "fireworks", id: "kimi-k3-fast", baseUrl: "https://api.fireworks.ai/inference/v1" }),
			).strategy,
		).toBe("prefix-sensitive");
	});
});
