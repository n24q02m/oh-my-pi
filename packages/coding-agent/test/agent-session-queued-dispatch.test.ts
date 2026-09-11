import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { scheduler } from "node:timers/promises";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { Effort, type Model } from "@oh-my-pi/pi-ai";
import { createMockModel, type MockResponse } from "@oh-my-pi/pi-ai/providers/mock";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { AUTO_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { tinyModelClient } from "@oh-my-pi/pi-coding-agent/tiny/title-client";
import { TempDir } from "@oh-my-pi/pi-utils";

/**
 * EF2.1 shared dispatch + bounded task context, exercised through the full
 * AgentSession surface (prompt, idle steer, settle-boundary steer, follow-up,
 * tool continuation, synthetic continuation).
 *
 * The classifier runs on the LOCAL backend (`qwen3-1.7b`) so tests intercept
 * exactly one seam: `tinyModelClient.complete`. No network. Waits poll real
 * event conditions (spy counts) on the real clock: fake timers break bun's
 * per-test timeout wheel for these event-gated drains — the same reason the
 * auto-compaction queue suite moved off fake timers (0aa17d9fe1). The waits
 * await a condition, never a guessed duration.
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

interface Gate {
	promise: Promise<void>;
	resolve: () => void;
}

function newGate(): Gate {
	return Promise.withResolvers<void>();
}

describe("AgentSession queued dispatch (EF2.1)", () => {
	let tempDir: TempDir;
	let fixtureDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession;

	beforeAll(async () => {
		fixtureDir = TempDir.createSync("@pi-queued-dispatch-fixture-");
		authStorage = await AuthStorage.create(path.join(fixtureDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("mock", "test-key");
		modelRegistry = new ModelRegistry(authStorage, path.join(fixtureDir.path(), "models.yml"));
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-queued-dispatch-");
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

	async function createSession(options: {
		responses: MockResponse[];
		adaptive: boolean;
		model?: Model;
		tools?: AgentTool[];
	}) {
		const model = options.model ?? (getBundledModel("anthropic", "claude-sonnet-4-5") as Model);
		const mock = createMockModel({ responses: options.responses });
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: options.tools ?? [] },
			streamFn: mock.stream,
			convertToLlm,
		});
		const settings = Settings.isolated({
			"providers.autoThinkingAdaptive": options.adaptive,
			"providers.autoThinkingModel": "qwen3-1.7b",
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
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

	it("delivers a legacy idle steer without classifying the queued batch", async () => {
		const { mock } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: false,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();

		await session.prompt("build the exporter");
		expect(complete).toHaveBeenCalledTimes(1);
		const levelAfterPrompt = session.thinkingLevel;

		await session.steer("vẫn lỗi, thử lại");
		await session.waitForIdle();

		// Documented legacy limitation: the queued batch dispatches with the
		// prompt-time classification; no classifier call for the queue.
		expect(complete).toHaveBeenCalledTimes(1);
		expect(session.thinkingLevel).toBe(levelAfterPrompt);
		expect(mock.calls.length).toBe(2);
		expect(session.agent.hasQueuedMessages()).toBe(false);
		expect(receipts.every(receipt => receipt.source !== "stale-batch")).toBe(true);
	});

	it("classifies the reserved idle-steer batch once when adaptive is on", async () => {
		const { mock } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("moderate");
		const receipts = decisionReceipts();

		await session.prompt("build the exporter");
		expect(complete).toHaveBeenCalledTimes(1);

		await session.steer("vẫn lỗi, thử lại");
		await session.waitForIdle();

		expect(complete).toHaveBeenCalledTimes(2);
		const queuedPrompt = complete.mock.calls[1]?.[1] as string;
		expect(queuedPrompt).toContain("<task-context>");
		expect(queuedPrompt).toContain("vẫn lỗi, thử lại");
		// The envelope carries the founding objective so a short continuation
		// is classified in task context, not in isolation.
		expect(queuedPrompt).toContain("build the exporter");
		expect(mock.calls.length).toBe(2);
		expect(session.agent.hasQueuedMessages()).toBe(false);
		const applied = receipts.filter(receipt => receipt.applied !== undefined).at(-1);
		expect(applied?.source).toBe("classifier");
		expect(applied?.classifierRequests).toBe(1);
	});

	it("classifies a multi-message batch once, in dispatch order", async () => {
		const { mock } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("moderate");

		await session.prompt("p1");
		// Both steers start before either resolves, so both messages land in the
		// steering queue before the drain's reservation snapshot is taken.
		const firstSteer = session.steer("first piece of context");
		const secondSteer = session.steer("vẫn lỗi phần export");
		await firstSteer;
		await secondSteer;
		await session.waitForIdle();

		expect(complete).toHaveBeenCalledTimes(2);
		const queuedPrompt = complete.mock.calls[1]?.[1] as string;
		const firstAt = queuedPrompt.indexOf("first piece of context");
		const secondAt = queuedPrompt.indexOf("vẫn lỗi phần export");
		expect(firstAt).toBeGreaterThanOrEqual(0);
		expect(secondAt).toBeGreaterThan(firstAt);
		// Default one-at-a-time steering dispatches each queued message as its own
		// request, all under the single batch classification — no duplicate classify.
		expect(mock.calls.length).toBe(3);
		expect(session.agent.hasQueuedMessages()).toBe(false);
	});

	it("discards a stale decision when a concurrent enqueue lands during classification", async () => {
		await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();
		const levelAfterPrompt = session.thinkingLevel;

		const promptGate = newGate();
		const drainGate = newGate();
		let callCount = 0;
		complete.mockImplementation(() => {
			callCount++;
			return (callCount === 1 ? promptGate : drainGate).promise.then(() => "moderate");
		});

		const promptDone = session.prompt("build the exporter");
		await waitFor(() => callCount === 1, "prompt classification started");
		promptGate.resolve();
		await promptDone;

		await session.steer("first steer");
		await waitFor(() => callCount === 2, "drain classification started");
		// Concurrent enqueue while the queued-batch classification is in flight.
		await session.steer("late arrival");
		drainGate.resolve();
		await session.waitForIdle();

		const stale = receipts.find(receipt => receipt.source === "stale-batch");
		expect(stale).toBeDefined();
		expect(stale?.applied).toBeUndefined();
		// Both messages dispatched; queue empty; level untouched by the stale decision.
		expect(session.agent.hasQueuedMessages()).toBe(false);
		expect(session.thinkingLevel).toBe(levelAfterPrompt);
	});

	it("applies nothing when the session is replaced during classification", async () => {
		await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();
		const levelAfterPrompt = session.thinkingLevel;

		const promptGate = newGate();
		const drainGate = newGate();
		let callCount = 0;
		complete.mockImplementation(() => {
			callCount++;
			return (callCount === 1 ? promptGate : drainGate).promise.then(() => "moderate");
		});

		const promptDone = session.prompt("build the exporter");
		await waitFor(() => callCount === 1, "prompt classification started");
		promptGate.resolve();
		await promptDone;

		await session.steer("queued work");
		await waitFor(() => callCount === 2, "drain classification started");
		// newSession() aborts in-flight post-prompt tasks and waits for them, so
		// start the switch and release the classification gate without awaiting in
		// between — awaiting the switch first would deadlock on the gated drain.
		const newSessionDone = session.newSession();
		drainGate.resolve();
		await newSessionDone;
		await session.waitForIdle();

		const dropped = receipts.filter(receipt => receipt.applied === undefined);
		expect(dropped.length).toBeGreaterThan(0);
		expect(session.thinkingLevel).toBe(levelAfterPrompt);
		// Replacement session dropped the queue: nothing dispatches the stale batch.
		expect(session.agent.hasQueuedMessages()).toBe(false);
	});

	it("applies nothing when abort supersedes a queued classification", async () => {
		await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();
		const levelAfterPrompt = session.thinkingLevel;

		const promptGate = newGate();
		const drainGate = newGate();
		let callCount = 0;
		complete.mockImplementation(() => {
			callCount++;
			return (callCount === 1 ? promptGate : drainGate).promise.then(() => "moderate");
		});

		const promptDone = session.prompt("build the exporter");
		await waitFor(() => callCount === 1, "prompt classification started");
		promptGate.resolve();
		await promptDone;

		await session.steer("queued work");
		await waitFor(() => callCount === 2, "drain classification started");
		session.abort();
		drainGate.resolve();
		await session.waitForIdle();

		const dropped = receipts.filter(receipt => receipt.source === "aborted" || receipt.source === "stale-batch");
		expect(dropped.length).toBeGreaterThan(0);
		expect(session.thinkingLevel).toBe(levelAfterPrompt);
	});

	it("invalidates the decision when the model switches during classification", async () => {
		const { session: active } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();
		const levelAfterPrompt = active.thinkingLevel;
		const otherModel = getBundledModel("anthropic", "claude-sonnet-4-6") as Model;

		const promptGate = newGate();
		const drainGate = newGate();
		let callCount = 0;
		complete.mockImplementation(() => {
			callCount++;
			return (callCount === 1 ? promptGate : drainGate).promise.then(() => "moderate");
		});

		const promptDone = active.prompt("build the exporter");
		await waitFor(() => callCount === 1, "prompt classification started");
		promptGate.resolve();
		await promptDone;

		await active.steer("queued work");
		await waitFor(() => callCount === 2, "drain classification started");
		await active.setModel(otherModel, "default", { persist: false });
		drainGate.resolve();
		await active.waitForIdle();

		const stale = receipts.find(receipt => receipt.source === "stale-batch");
		expect(stale).toBeDefined();
		expect(stale?.applied).toBeUndefined();
		expect(active.thinkingLevel).toBe(levelAfterPrompt);
	});

	it("invalidates the decision when the queued batch is edited during classification", async () => {
		await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();
		const levelAfterPrompt = session.thinkingLevel;

		const promptGate = newGate();
		const drainGate = newGate();
		let callCount = 0;
		complete.mockImplementation(() => {
			callCount++;
			return (callCount === 1 ? promptGate : drainGate).promise.then(() => "moderate");
		});

		const promptDone = session.prompt("build the exporter");
		await waitFor(() => callCount === 1, "prompt classification started");
		promptGate.resolve();
		await promptDone;

		const firstSteer = session.steer("queued work");
		const secondSteer = session.steer("second queued");
		await firstSteer;
		await secondSteer;
		await waitFor(() => callCount === 2, "drain classification started");
		// Dequeue path: the user edits the pending batch mid-flight by removing a
		// message through the same replaceQueues mechanics as the UI dequeue.
		const steering = session.agent.peekSteeringQueue().slice();
		const removed = steering[0];
		session.agent.replaceQueues(
			steering.filter(message => message !== removed),
			[...session.agent.peekFollowUpQueue()],
		);
		drainGate.resolve();
		await session.waitForIdle();
		const stale = receipts.find(receipt => receipt.source === "stale-batch");
		expect(stale).toBeDefined();
		expect(session.thinkingLevel).toBe(levelAfterPrompt);
		expect(session.agent.hasQueuedMessages()).toBe(false);
	});

	it("never re-classifies plain tool continuations", async () => {
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "read a file",
			parameters: {},
			async execute(_toolCallId, _args) {
				return { content: [{ type: "text", text: "file body" }], isError: false };
			},
		};
		const { mock } = await createSession({
			responses: [
				{ content: [{ type: "toolCall", name: "read", arguments: { path: "/x" } }] },
				{ content: ["done"] },
			],
			adaptive: true,
			tools: [readTool],
		});
		const complete = classifierSpy();

		await session.prompt("inspect the file");
		await session.waitForIdle();

		// One classification for the user turn; the toolResult continuation ran
		// through the loop without paying another classifier call.
		expect(complete).toHaveBeenCalledTimes(1);
		expect(mock.calls.length).toBe(2);
	});

	it("dispatches synthetic agent-originated continuations without a classifier call", async () => {
		const { mock } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();

		await session.prompt("build the exporter");
		expect(complete).toHaveBeenCalledTimes(1);

		await session.followUp("execute the approved plan", undefined, { synthetic: true });
		await session.waitForIdle();

		expect(complete).toHaveBeenCalledTimes(1);
		expect(mock.calls.length).toBe(2);
		expect(session.agent.hasQueuedMessages()).toBe(false);
		// The synthetic directive reached the dispatched continuation request.
		const dispatched = mock.calls.at(-1);
		expect(JSON.stringify(dispatched)).toContain("execute the approved plan");
	});

	it("reuses the singleton fast-path before any online inference on queued batches", async () => {
		const ladderModel = buildModel({
			id: "mock-high-only",
			name: "mock-high-only",
			api: "openai-completions",
			provider: "mock",
			baseUrl: "https://example.com",
			reasoning: true,
			thinking: { mode: "effort", efforts: [Effort.High] },
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 4096,
		});
		const { mock } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
			model: ladderModel,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();

		await session.prompt("build the exporter");
		await session.steer("vẫn lỗi, thử lại");
		await session.waitForIdle();

		// Every label collapses to one outcome on this ladder: neither the
		// prompt nor the queued batch pays a classifier request.
		expect(complete).not.toHaveBeenCalled();
		expect(mock.calls.length).toBe(2);
		expect(session.thinkingLevel).toBe(Effort.High);
		const singletonReceipts = receipts.filter(receipt => receipt.source === "singleton");
		expect(singletonReceipts.length).toBe(2);
	});

	it("keeps the raw prompt text for legacy classification input", async () => {
		await createSession({
			responses: [{ content: ["r1"] }],
			adaptive: false,
		});
		const complete = classifierSpy();
		complete.mockResolvedValue("moderate");

		await session.prompt("build the exporter");
		expect(complete).toHaveBeenCalledTimes(1);
		// Legacy keeps the shared classifier input: the raw prompt passes through
		// preprocessing into the local classifier template — never the envelope.
		const legacyInput = complete.mock.calls[0]?.[1] as string;
		expect(legacyInput).toContain("build the exporter");
		expect(legacyInput).not.toContain("<task-context>");
	});

	it("wraps the prompt in the bounded task-context envelope when adaptive is on", async () => {
		await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();

		await session.prompt("build the exporter");
		// First prompt: empty transcript → explicit conservative objective.
		const firstPrompt = complete.mock.calls[0]?.[1] as string;
		expect(firstPrompt).toContain("<task-context>");
		expect(firstPrompt).toContain("(unknown");
		expect(firstPrompt).toContain("build the exporter");
		expect(firstPrompt.length).toBeLessThanOrEqual(4000);

		await session.steer("vẫn lỗi, thử lại");
		await session.waitForIdle();
		const queuedPrompt = complete.mock.calls[1]?.[1] as string;
		expect(queuedPrompt).toContain("build the exporter");
		expect(queuedPrompt.length).toBeLessThanOrEqual(4000);
	});

	it("preserves the classifier fallback path on queued dispatch failures", async () => {
		await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();
		const receipts = decisionReceipts();
		const levelAfterPrompt = session.thinkingLevel;

		complete.mockResolvedValueOnce("moderate");
		await session.prompt("build the exporter");
		complete.mockRejectedValue(new Error("local classifier unavailable"));

		await session.steer("vẫn lỗi, thử lại");
		await session.waitForIdle();

		const fallback = receipts.filter(receipt => receipt.source === "fallback");
		expect(fallback.length).toBe(1);
		expect(fallback[0]?.classifierRequests).toBe(1);
		expect(String(fallback[0]?.failure)).toContain("local classifier unavailable");
		// The batch still dispatched with the preserved level.
		expect(session.agent.hasQueuedMessages()).toBe(false);
		expect(session.thinkingLevel).toBe(levelAfterPrompt);
	});

	it("classifies a settle-boundary steer injected after the final queue poll", async () => {
		const { mock } = await createSession({
			responses: [{ content: ["r1"] }, { content: ["r2"] }],
			adaptive: true,
		});
		const complete = classifierSpy();

		let agentEnds = 0;
		session.subscribe(event => {
			if (event.type !== "agent_end") return;
			agentEnds++;
			if (agentEnds === 1) {
				session.agent.steer({
					role: "user",
					content: [{ type: "text", text: "steer landed at settle" }],
					steering: true,
					attribution: "user",
					timestamp: Date.now(),
				});
			}
		});

		await session.prompt("hello");
		await session.waitForIdle();

		expect(complete).toHaveBeenCalledTimes(2);
		const queuedPrompt = complete.mock.calls[1]?.[1] as string;
		expect(queuedPrompt).toContain("steer landed at settle");
		expect(mock.calls.length).toBe(2);
		expect(session.agent.hasQueuedMessages()).toBe(false);
	});
});
