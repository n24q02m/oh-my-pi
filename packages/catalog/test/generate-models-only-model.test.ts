import { describe, expect, it } from "bun:test";
import {
	mergeOnlyModel,
	parseOnlyModelArg,
	parseOnlyModelSelector,
	resolveOnlyModelTarget,
	resolveStaticOnlyModel,
} from "../scripts/generate-models";
import { buildModel } from "../src/build";
import { GITHUB_COPILOT_AUTO_STATIC_MODELS } from "../src/provider-models/openai-compat";
import type { Model, ModelSpec } from "../src/types";

function fakeModel(provider: string, id: string, name = id): Model {
	const spec: ModelSpec<"openai-completions"> = {
		id,
		name,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};
	return buildModel(spec);
}

describe("generate-models --only-model helpers", () => {
	it("parses provider/model-id at first slash, preserving slashes in model id", () => {
		expect(parseOnlyModelSelector("github-copilot/auto")).toEqual({ provider: "github-copilot", modelId: "auto" });
		expect(parseOnlyModelSelector("openrouter/z-ai/glm-5.2:free")).toEqual({
			provider: "openrouter",
			modelId: "z-ai/glm-5.2:free",
		});
	});

	it("rejects malformed selectors", () => {
		expect(() => parseOnlyModelSelector("")).toThrow();
		expect(() => parseOnlyModelSelector("no-slash")).toThrow();
		expect(() => parseOnlyModelSelector("/leading")).toThrow();
		expect(() => parseOnlyModelSelector("trailing/")).toThrow();
	});

	it("parses argv flag", () => {
		expect(parseOnlyModelArg([])).toBeUndefined();
		expect(parseOnlyModelArg(["--only-model", "github-copilot/auto"])).toBe("github-copilot/auto");
		expect(() => parseOnlyModelArg(["--only-model"])).toThrow();
		expect(() => parseOnlyModelArg(["--only-model", "--other"])).toThrow();
	});

	it("mergeOnlyModel preserves unrelated providers and sorts target provider", () => {
		const prev: Record<string, Record<string, Model>> = {
			openai: { "gpt-4": fakeModel("openai", "gpt-4") },
			"github-copilot": {
				"gpt-5.5": fakeModel("github-copilot", "gpt-5.5"),
				"claude-sonnet-4.6": fakeModel("github-copilot", "claude-sonnet-4.6"),
			},
		};
		const previousCopilotModels = prev["github-copilot"];
		const auto = buildModel(GITHUB_COPILOT_AUTO_STATIC_MODELS[0]);
		const patched = mergeOnlyModel(prev, "github-copilot", "auto", auto);

		expect(patched).not.toBe(prev);
		expect(patched.openai).toBe(prev.openai);
		expect(patched["github-copilot"]).not.toBe(previousCopilotModels);
		expect(Object.keys(patched["github-copilot"])).toEqual(["auto", "claude-sonnet-4.6", "gpt-5.5"]);
		expect(patched["github-copilot"].auto.id).toBe("auto");
		expect(patched["github-copilot"].auto.api).toBe("openai-completions");
		expect(prev["github-copilot"].auto).toBeUndefined();
	});

	it("mergeOnlyModel creates provider if missing", () => {
		const prev: Record<string, Record<string, Model>> = {};
		const auto = buildModel(GITHUB_COPILOT_AUTO_STATIC_MODELS[0]);
		const patched = mergeOnlyModel(prev, "github-copilot", "auto", auto);
		expect(Object.keys(patched["github-copilot"])).toEqual(["auto"]);
	});

	it("resolveOnlyModelTarget throws for missing target", () => {
		const fakeModels: Record<string, Record<string, Model>> = { "github-copilot": {} };
		expect(() => resolveOnlyModelTarget(fakeModels, "github-copilot/nonexistent")).toThrow(/not found/);
		expect(() => resolveOnlyModelTarget(fakeModels, "github-copilot/auto")).toThrow(/not found/);
	});

	it("resolves the static Auto target without dynamic catalog assembly", () => {
		const auto = resolveStaticOnlyModel("github-copilot/auto");
		expect(auto).toBeDefined();
		expect(auto?.id).toBe("auto");
		expect(auto?.api).toBe("openai-completions");
		expect(resolveStaticOnlyModel("github-copilot/unknown")).toBeUndefined();
	});

	it("resolveOnlyModelTarget returns canonical model", () => {
		const auto = buildModel(GITHUB_COPILOT_AUTO_STATIC_MODELS[0]);
		const models: Record<string, Record<string, Model>> = { "github-copilot": { auto } };
		expect(resolveOnlyModelTarget(models, "github-copilot/auto")).toEqual(auto);
	});
});
