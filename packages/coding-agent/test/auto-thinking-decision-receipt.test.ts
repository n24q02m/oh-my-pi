import { describe, expect, it } from "bun:test";
import { Effort } from "@oh-my-pi/pi-ai";
import {
	autoThinkingDecisionReceipt,
	detectPromptCacheDrop,
	type PromptCacheSample,
} from "@oh-my-pi/pi-coding-agent/auto-thinking/decision-receipt";

/** Every field a receipt is allowed to carry; anything else is a redaction breach. */
const RECEIPT_KEYS = new Set([
	"generation",
	"provider",
	"modelId",
	"source",
	"previous",
	"candidate",
	"applied",
	"durationMs",
	"classifierRequests",
	"failure",
]);

function sampleReceipt() {
	return autoThinkingDecisionReceipt({
		generation: 7,
		provider: "anthropic",
		modelId: "claude-sonnet-4-6",
		source: "classifier",
		previous: "off",
		candidate: Effort.High,
		applied: Effort.High,
		durationMs: 812,
		classifierRequests: 1,
		failure: undefined,
	});
}

describe("auto thinking decision receipt", () => {
	it("serializes to exactly the allowlisted keys", () => {
		const serialized = JSON.parse(JSON.stringify(sampleReceipt())) as Record<string, unknown>;
		for (const key of Object.keys(serialized)) {
			expect(RECEIPT_KEYS.has(key)).toBe(true);
		}
	});

	it("carries no prompt, reasoning, usage, or credential-shaped fields", () => {
		const serialized = JSON.stringify(sampleReceipt());
		for (const banned of ["prompt", "message", "reasoning", "thinking_text", "usage", "apiKey", "token"]) {
			expect(serialized.toLowerCase().includes(banned)).toBe(false);
		}
	});

	it("truncates failure to the bounded length and never stores a stack body", () => {
		const longFailure = `${"provider exploded: ".repeat(40)}{"raw":"body"}`;
		const receipt = autoThinkingDecisionReceipt({
			generation: 1,
			provider: "openai",
			modelId: "gpt-5",
			source: "fallback",
			previous: undefined,
			candidate: undefined,
			applied: undefined,
			durationMs: 5,
			classifierRequests: 1,
			failure: longFailure,
		});
		expect(receipt.failure).toBeDefined();
		const truncated = receipt.failure as string;
		expect(truncated.length).toBeLessThanOrEqual(200);
		expect(truncated).not.toContain('"raw":"body"');
		expect(truncated.startsWith("provider exploded:")).toBe(true);
	});

	it("keeps clean failures verbatim and preserves aborted receipts without applied level", () => {
		const receipt = autoThinkingDecisionReceipt({
			generation: 2,
			provider: "google",
			modelId: "gemini-3-flash",
			source: "aborted",
			previous: Effort.Medium,
			candidate: undefined,
			applied: undefined,
			durationMs: 90,
			classifierRequests: 0,
			failure: undefined,
		});
		expect(receipt.failure).toBeUndefined();
		expect(receipt.source).toBe("aborted");
		expect(receipt.applied).toBeUndefined();
	});
});

describe("prompt cache drop detector", () => {
	const provider = "anthropic";
	const modelId = "claude-sonnet-4-6";

	function sample(cacheReadTokens: number, atMs: number): PromptCacheSample {
		return { cacheReadTokens, atMs };
	}

	it("ignores cold starts, zero-run noise, and warm continuations", () => {
		const warm = sample(4096, 1_000);
		const cold = sample(0, 2_000);
		expect(detectPromptCacheDrop(provider, modelId, undefined, warm, undefined)).toBeUndefined();
		expect(detectPromptCacheDrop(provider, modelId, undefined, cold, undefined)).toBeUndefined();
		expect(detectPromptCacheDrop(provider, modelId, cold, cold, undefined)).toBeUndefined();
		expect(detectPromptCacheDrop(provider, modelId, warm, sample(2048, 2_000), undefined)).toBeUndefined();
	});

	it("attributes a warm-to-zero drop to an effort change only when one landed between samples", () => {
		const warm = sample(4096, 1_000);
		const zero = sample(0, 3_000);
		const attributed = detectPromptCacheDrop(provider, modelId, warm, zero, 2_000);
		expect(attributed).toEqual({
			provider,
			modelId,
			previousCacheReadTokens: 4096,
			cause: "effort_change",
		});
		const unestablished = detectPromptCacheDrop(provider, modelId, warm, zero, undefined);
		expect(unestablished).toEqual({ provider, modelId, previousCacheReadTokens: 4096, cause: "unestablished" });
		const beforePrevious = detectPromptCacheDrop(provider, modelId, warm, zero, 500);
		expect(beforePrevious?.cause).toBe("unestablished");
		const afterNext = detectPromptCacheDrop(provider, modelId, warm, zero, 3_500);
		expect(afterNext?.cause).toBe("unestablished");
	});

	it("keeps the drop record redacted: no usage, prompt, or credential fields", () => {
		const serialized = JSON.stringify(
			detectPromptCacheDrop(provider, modelId, sample(512, 1_000), sample(0, 2_000), 1_500),
		);
		expect(serialized).toBe(
			JSON.stringify({ provider, modelId, previousCacheReadTokens: 512, cause: "effort_change" }),
		);
	});
});
