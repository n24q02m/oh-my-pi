/**
 * EF1.4 funnel-observer integration: the cache-drop wiring in AgentSession's
 * assistant-message path must feed consecutive per-model usage samples through
 * `detectPromptCacheDrop` on normal turns, and must skip errored and aborted
 * responses entirely — they carry no trustworthy cache evidence, so they
 * neither emit a drop nor clobber the last warm sample (same guard precedent
 * as `#persistSessionMessageIfMissing`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { scheduler } from "node:timers/promises";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel, type MockHandler } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

// The session schedules post-turn settle passes through scheduler.wait with
// blind wall-clock delays; collapse them to a single macrotask hop so the
// scenarios stay deterministic under CI load (same idiom as
// agent-session-concurrent).
const originalSchedulerWait = scheduler.wait.bind(scheduler);
function collapseSchedulerSettleDelays(): void {
	vi.spyOn(scheduler, "wait").mockImplementation((_delayMs, options) => originalSchedulerWait(0, options));
}

describe("AgentSession prompt cache drop observer (EF1.4)", () => {
	let session: AgentSession | undefined;

	beforeEach(() => {
		collapseSchedulerSettleDelays();
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
			session = undefined;
		}
		vi.restoreAllMocks();
	});

	function buildSession(responses: MockHandler[]) {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Claude Sonnet 4.5 model");
		const mock = createMockModel({ responses });
		const authStorage = createInMemoryAuthStorage();
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		session = new AgentSession({
			agent: new Agent({
				getApiKey: () => "test-key",
				initialState: { model, systemPrompt: ["Test"], tools: [] },
				streamFn: mock.stream,
				convertToLlm,
			}),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
		});
		const events: AgentSessionEvent[] = [];
		session.subscribe(event => events.push(event));
		const drops = () =>
			events.filter(
				(event): event is Extract<AgentSessionEvent, { type: "prompt_cache_dropped" }> =>
					event.type === "prompt_cache_dropped",
			);
		return { mock, events, drops };
	}

	it(
		"emits one redacted drop on a normal warm→cold turn sequence, not on warm→warm",
		async () => {
			const marker = "FUNNEL-MARKER-normal-path";
			const { drops } = buildSession([
				{ content: ["warm one"], usage: { cacheRead: 500 } },
				{ content: ["warm two"], usage: { cacheRead: 300 } },
				{ content: ["cold three"], usage: { cacheRead: 0 } },
			]);

			await session!.prompt(marker);
			expect(drops()).toHaveLength(0);
			await session!.prompt("warm again");
			expect(drops()).toHaveLength(0);
			await session!.prompt("cold now");
			await session!.waitForIdle();

			const recorded = drops();
			expect(recorded).toHaveLength(1);
			expect(recorded[0]?.drop).toMatchObject({
				provider: "mock",
				modelId: "mock-model",
				previousCacheReadTokens: 300,
				// No auto-thinking change happened between the samples, so the drop
				// stays unestablished instead of being attributed to an effort change.
				cause: "unestablished",
			});
			// Redaction by construction: the emitted record never carries prompt text.
			expect(JSON.stringify(recorded)).not.toContain(marker);
		},
		30_000,
	);

	it(
		"error turns neither emit a drop nor clobber the last warm sample",
		async () => {
			const { drops } = buildSession([
				{ content: ["warm one"], usage: { cacheRead: 500 } },
				{ throw: new Error("synthetic provider failure") },
				{ content: ["warm three"], usage: { cacheRead: 200 } },
				{ content: ["cold four"], usage: { cacheRead: 0 } },
			]);

			await session!.prompt("warm start");
			await session!.prompt("failing turn");
			// The errored response reports zero cache reads after a warm sample; a
			// missing stopReason guard would have emitted a drop here.
			expect(drops()).toHaveLength(0);
			await session!.prompt("warm recovery");
			await session!.prompt("cold after recovery");
			await session!.waitForIdle();

			const recorded = drops();
			// Exactly one drop, anchored to the last warm sample (200), proving the
			// errored turn neither compared against nor replaced the warm sample.
			expect(recorded).toHaveLength(1);
			expect(recorded[0]?.drop.previousCacheReadTokens).toBe(200);
			expect(recorded[0]?.drop.cause).toBe("unestablished");
		},
		30_000,
	);

	it(
		"aborted turns neither emit a drop nor clobber the last warm sample",
		async () => {
			const abortCallStarted = Promise.withResolvers<void>();
			const { drops } = buildSession([
				{ content: ["warm one"], usage: { cacheRead: 500 } },
				() => {
					abortCallStarted.resolve();
					return { content: ["slow turn"], delayMs: 30_000 };
				},
				{ content: ["warm three"], usage: { cacheRead: 200 } },
				{ content: ["cold four"], usage: { cacheRead: 0 } },
			]);

			// Turn 1 warms the per-model sample; turn 2 is aborted mid-stream.
			await session!.prompt("warm start");
			const promptPromise = session!.prompt("abort probe");
			await abortCallStarted.promise;
			await session!.abort();
			await promptPromise;
			await session!.waitForIdle();
			// The aborted response reports zero cache reads after a warm sample; a
			// missing stopReason guard would have emitted a drop here.
			expect(drops()).toHaveLength(0);
			await session!.prompt("warm recovery");
			await session!.prompt("cold after recovery");
			await session!.waitForIdle();

			const recorded = drops();
			// Exactly one drop, anchored to the last warm sample (200), proving the
			// aborted turn neither compared against nor replaced the warm sample.
			expect(recorded).toHaveLength(1);
			expect(recorded[0]?.drop.previousCacheReadTokens).toBe(200);
			expect(recorded[0]?.drop.cause).toBe("unestablished");
		},
		30_000,
	);
});
