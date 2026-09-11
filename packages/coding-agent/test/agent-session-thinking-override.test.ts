import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { scheduler } from "node:timers/promises";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { Effort, type Model } from "@oh-my-pi/pi-ai";
import { createMockModel, type MockResponse } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { AUTO_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { tinyModelClient } from "@oh-my-pi/pi-coding-agent/tiny/title-client";
import { ThinkingEffortTool } from "@oh-my-pi/pi-coding-agent/tools/thinking-effort";
import { TempDir } from "@oh-my-pi/pi-utils";

/**
 * EF2-R3 next-request override over the full AgentSession surface: the model
 * proposes a thinking effort through the `thinking_effort` tool mid-run, the
 * NEXT main logical request dispatches at that effort, and the following one
 * returns to the auto baseline. The in-flight run that carried the proposal
 * never changes its own effort (every LLM call of that run keeps the old
 * level — observable via the recorded mock `reasoning` per call).
 *
 * Same seam discipline as the EF2.1 suite: the classifier runs on the LOCAL
 * qwen3-1.7b backend with `tinyModelClient.complete` as the only intercept; no
 * network; waits poll real event conditions on the real clock.
 */

const originalSchedulerWait = scheduler.wait.bind(scheduler);
function collapseSchedulerSettleDelays(): void {
	vi.spyOn(scheduler, "wait").mockImplementation((_delayMs, options) => originalSchedulerWait(0, options));
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`waitFor timed out: ${what}`);
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

describe("AgentSession next-request thinking override (EF2.2)", () => {
	let tempDir: TempDir;
	let fixtureDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession;

	beforeAll(async () => {
		fixtureDir = TempDir.createSync("@pi-thinking-override-fixture-");
		authStorage = await AuthStorage.create(path.join(fixtureDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("mock", "test-key");
		modelRegistry = new ModelRegistry(authStorage, path.join(fixtureDir.path(), "models.yml"));
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-thinking-override-");
		collapseSchedulerSettleDelays();
	});

	afterEach(async () => {
		if (session) await session.dispose();
		tempDir.removeSync();
		vi.restoreAllMocks();
	});

	afterAll(() => {
		authStorage.close();
		fixtureDir.removeSync();
	});

	async function createSession(options: { responses: MockResponse[]; adaptive?: boolean; model?: Model }) {
		const model = options.model ?? (getBundledModel("anthropic", "claude-sonnet-4-5") as Model);
		const mock = createMockModel({ responses: options.responses });
		// The override tool is wired through a late-bound session reference: the
		// tool must exist before the AgentSession (agent initialState), but its
		// proposals route into the real session once constructed.
		let lateSession: AgentSession | undefined;
		const overrideTool = new ThinkingEffortTool({
			proposeThinkingEffort: requested => lateSession?.proposeThinkingEffort(requested),
		});
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [overrideTool] },
			streamFn: mock.stream,
			convertToLlm,
		});
		const settings = Settings.isolated({
			"providers.autoThinkingAdaptive": options.adaptive ?? true,
			"providers.autoThinkingModel": "qwen3-1.7b",
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		lateSession = session;
		session.setThinkingLevel(AUTO_THINKING);
		return { session, mock, settings };
	}

	function classifierSpy() {
		return vi.spyOn(tinyModelClient, "complete");
	}

	function decisionReceipts(): Array<Record<string, unknown>> {
		const collected: Array<Record<string, unknown>> = [];
		session.subscribe(event => {
			if (event.type === "auto_thinking_decision") {
				collected.push(JSON.parse(JSON.stringify(event.receipt)) as Record<string, unknown>);
			}
		});
		return collected;
	}

	function reasoningByCall(mock: { calls: Array<{ options?: { reasoning?: string } }> }): Array<string | undefined> {
		return mock.calls.map(call => call.options?.reasoning);
	}

	it("runs low → tool proposes high → next request high → back to baseline, without touching the in-flight run", async () => {
		const { mock } = await createSession({
			responses: [
				{ content: ["r1"] },
				{ content: [{ type: "toolCall", name: "thinking_effort", arguments: { effort: "high" } }] },
				{ content: ["r2"] },
				{ content: ["r3"] },
				{ content: ["r4"] },
			],
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("trivial");
		const receipts = decisionReceipts();

		await session.prompt("start the task");
		expect(session.thinkingLevel).toBe(Effort.Low);

		// The proposing run: classification says low, the tool proposes high
		// mid-run, and the tool-result continuation (same run) must STILL
		// dispatch at low — a proposal cannot change the response in flight.
		await session.prompt("this is getting complicated");
		expect(complete).toHaveBeenCalledTimes(2);
		expect(session.thinkingLevel).toBe(Effort.Low);
		expect(receipts.some(receipt => receipt.source === "override")).toBe(false);

		// Next main logical request consumes the override: dispatches at high
		// without paying a classifier call.
		await session.prompt("go deeper");
		expect(complete).toHaveBeenCalledTimes(2);
		expect(session.thinkingLevel).toBe(Effort.Low);

		// The following request is back on the auto baseline.
		await session.prompt("wrap up");
		expect(complete).toHaveBeenCalledTimes(3);
		expect(session.thinkingLevel).toBe(Effort.Low);

		const reasoning = reasoningByCall(mock);
		expect(reasoning).toEqual(["low", "low", "low", "high", "low"]);

		const overrideReceipts = receipts.filter(receipt => receipt.source === "override");
		expect(overrideReceipts).toHaveLength(1);
		expect(overrideReceipts[0]?.applied).toBe("high");
		expect(overrideReceipts[0]?.classifierRequests).toBe(0);
		const expired = receipts.filter(receipt => receipt.source === "override-expired");
		expect(expired).toHaveLength(1);
		expect(expired[0]?.applied).toBe("low");
		// Configured policy never left `auto`.
		expect(session.configuredThinkingLevel()).toBe(AUTO_THINKING);
	});

	it("consumes the override on a queued steer dispatch and skips that batch's classifier", async () => {
		const { mock } = await createSession({
			responses: [
				{ content: [{ type: "toolCall", name: "thinking_effort", arguments: { effort: "high" } }] },
				{ content: ["r1"] },
				{ content: ["r2"] },
				{ content: ["r3"] },
			],
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("trivial");

		await session.prompt("start the task");
		expect(complete).toHaveBeenCalledTimes(1);
		expect(session.thinkingLevel).toBe(Effort.Low);

		// Queued steer becomes the next main logical request: the pending
		// override applies to it and no classifier runs for the batch.
		await session.steer("vẫn lỗi, thử tiếp đi");
		await waitFor(() => mock.calls.length >= 3, "steered dispatch");
		await session.waitForIdle();
		expect(complete).toHaveBeenCalledTimes(1);
		expect(session.thinkingLevel).toBe(Effort.Low);

		// A later steer classifies again (override expired).
		await session.steer("and continue");
		await waitFor(() => mock.calls.length >= 4, "second steer dispatch");
		await session.waitForIdle();
		expect(complete).toHaveBeenCalledTimes(2);

		const reasoning = reasoningByCall(mock);
		expect(reasoning[0]).toBe("low");
		expect(reasoning[1]).toBe("low");
		expect(reasoning[2]).toBe("high");
		expect(reasoning[3]).toBe("low");
	});

	it("rejects proposals when adaptive mode is off and leaves the auto flow untouched", async () => {
		const { mock } = await createSession({
			responses: [
				{ content: [{ type: "toolCall", name: "thinking_effort", arguments: { effort: "high" } }] },
				{ content: ["r1"] },
				{ content: ["r2"] },
			],
			adaptive: false,
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("trivial");

		await session.prompt("start the task");
		expect(session.proposeThinkingEffort("high").accepted).toBe(false);
		await session.waitForIdle();

		expect(complete).toHaveBeenCalledTimes(1);
		expect(session.thinkingLevel).toBe(Effort.Low);
		expect(reasoningByCall(mock).every(reasoning => reasoning === "low")).toBe(true);
	});

	it("manual concrete pin outranks a pending override", async () => {
		const { mock } = await createSession({
			responses: [
				{ content: [{ type: "toolCall", name: "thinking_effort", arguments: { effort: "high" } }] },
				{ content: ["r1"] },
				{ content: ["r2"] },
			],
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("trivial");

		await session.prompt("start the task");
		expect(session.proposeThinkingEffort("high").accepted).toBe(true);
		await session.waitForIdle();

		// The user pins a concrete level: auto disables and the override dies.
		session.setThinkingLevel(Effort.Medium);
		expect(session.isAutoThinking).toBe(false);

		await session.prompt("keep going");
		expect(session.thinkingLevel).toBe(Effort.Medium);
		expect(reasoningByCall(mock).at(-1)).toBe("medium");
	});

	it("a cancellation after the proposal drops it before the next dispatch", async () => {
		const { mock } = await createSession({
			responses: [
				{ content: [{ type: "toolCall", name: "thinking_effort", arguments: { effort: "high" } }] },
				{ content: ["r1"] },
				{ content: ["r2"] },
			],
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("trivial");

		await session.prompt("start the task");
		await session.waitForIdle();
		expect(session.proposeThinkingEffort("high").accepted).toBe(true);

		session.abort();
		await session.waitForIdle();

		await session.prompt("fresh start");
		// Stale proposal dropped: the new prompt classified normally at low.
		expect(complete).toHaveBeenCalledTimes(2);
		expect(session.thinkingLevel).toBe(Effort.Low);
		expect(reasoningByCall(mock).at(-1)).toBe("low");
	});
});
