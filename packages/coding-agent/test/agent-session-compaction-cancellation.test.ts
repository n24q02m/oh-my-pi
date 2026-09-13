import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Agent, CompactionCancelledError } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Message } from "@oh-my-pi/pi-ai";
import * as codexResponses from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ExtensionRuntime, loadExtensionFromFactory } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { USER_INTERRUPT_LABEL } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { TempDir, withTimeout } from "@oh-my-pi/pi-utils";

type HookMode = "extension-veto" | "park";

describe("AgentSession compaction cancellation source", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-compaction-cancellation-");
		authStorage = await AuthStorage.create(":memory:");
		authStorage.setRuntimeApiKey("anthropic", "test-key");
	});

	afterEach(async () => {
		await session?.dispose();
		authStorage.close();
		tempDir.removeSync();
	});

	async function createSession(mode: HookMode, entered?: () => void, gate?: Promise<void>): Promise<AgentSession> {
		const runtime = new ExtensionRuntime();
		const extension = await loadExtensionFromFactory(
			pi => {
				pi.on("session_before_compact", async event => {
					if (mode === "extension-veto") return { cancel: true };
					entered?.();
					await gate;
					return {
						compaction: {
							summary: "compacted",
							shortSummary: undefined,
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					};
				});
			},
			tempDir.path(),
			new EventBus(),
			runtime,
			"compaction-cancellation-source",
		);
		const sessionManager = SessionManager.inMemory(tempDir.path());
		const modelRegistry = new ModelRegistry(authStorage);
		const extensionRunner = new ExtensionRunner([extension], runtime, tempDir.path(), sessionManager, modelRegistry);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic model");
		const agent = new Agent({
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
		});

		sessionManager.appendMessage({ role: "user", content: "first turn", timestamp: Date.now() });
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "first answer" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: model.id,
			stopReason: "stop",
			usage: {
				input: 1_000,
				output: 100,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 1_100,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({ role: "user", content: "second turn", timestamp: Date.now() });

		return new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.keepRecentTokens": 1 }),
			modelRegistry,
			extensionRunner,
		});
	}

	async function cancellationFrom(promise: Promise<unknown>): Promise<CompactionCancelledError> {
		try {
			await promise;
		} catch (error) {
			if (error instanceof CompactionCancelledError) return error;
			throw error;
		}
		throw new Error("Expected compaction cancellation");
	}

	it("leaves extension vetoes unmarked as user interrupts", async () => {
		session = await createSession("extension-veto");

		const error = await cancellationFrom(session.compact());
		expect(error.cause).toBeUndefined();
	});

	it("waits for manual compaction cleanup before starting a replacement prompt", async () => {
		const started = Promise.withResolvers<void>();
		const gate = Promise.withResolvers<void>();
		session = await createSession("park", started.resolve, gate.promise);

		const cancellation = cancellationFrom(session.compact());
		await started.promise;
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue(true);
		const abortAndPrompt = session
			.abort({ reason: USER_INTERRUPT_LABEL })
			.then(() => session.prompt("replacement prompt"));

		await Promise.resolve();
		expect(prompt).not.toHaveBeenCalled();
		expect(session.isCompacting).toBe(true);

		gate.resolve();
		await abortAndPrompt;
		expect(session.isCompacting).toBe(false);
		expect(prompt).toHaveBeenCalledWith("replacement prompt");

		const error = await cancellation;
		expect(error.cause).toBe(USER_INTERRUPT_LABEL);
	});

	it("blocks an ordinary prompt until manual compaction cleanup resolves", async () => {
		const started = Promise.withResolvers<void>();
		const gate = Promise.withResolvers<void>();
		session = await createSession("park", started.resolve, gate.promise);

		// The turn dispatch seam: prompt() must not reach it while compaction holds
		// the agent subscription disconnected.
		const agentPrompt = vi.spyOn(session.agent, "prompt").mockImplementation(async () => {});

		const compaction = session.compact();
		await started.promise;

		let promptSettled = false;
		const promptPromise = session.prompt("normal prompt").then(result => {
			promptSettled = true;
			return result;
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(session.isCompacting).toBe(true);
		expect(agentPrompt).not.toHaveBeenCalled();
		expect(promptSettled).toBe(false);

		gate.resolve();
		await compaction;
		await promptPromise;
		expect(agentPrompt).toHaveBeenCalledTimes(1);
	});
	it("cancels automatic Codex V2 compaction before manual snapcompact and foreground recovery", async () => {
		const bundledModel = getBundledModel("openai-codex", "gpt-5.6-terra");
		if (!bundledModel) throw new Error("Expected bundled Codex model");
		const model = { ...bundledModel, contextWindow: 200_000, maxTokens: 1_000 };
		authStorage.setRuntimeApiKey("openai-codex", "test-key");
		const automaticStarted = Promise.withResolvers<void>();
		let nativeCalls = 0;
		const nativeCompaction = vi
			.spyOn(codexResponses, "openCodexCompactionEventStream")
			.mockImplementation(async (_model, _body, options) => {
				nativeCalls++;
				if (nativeCalls === 1) {
					automaticStarted.resolve();
					return (async function* () {
						await new Promise<void>(resolve => {
							options.signal?.addEventListener("abort", () => resolve(), { once: true });
						});
						throw new DOMException("The operation was aborted", "AbortError");
					})();
				}
				return (async function* () {
					yield {
						type: "response.output_item.done",
						item: { type: "compaction", encrypted_content: "controlled-v2-summary" },
					};
					yield {
						type: "response.completed",
						response: { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
					};
				})();
			});

		const sessionManager = SessionManager.inMemory(tempDir.path());
		const settings = Settings.isolated({
			"compaction.methodOrder": ["remote", "snapcompact"],
			"compaction.asyncEnabled": false,
			"compaction.autoContinue": false,
			"compaction.keepRecentTokens": 4000,
			"compaction.reserveTokens": 100_000,
			"compaction.thresholdTokens": 1,
			"snapcompact.shape": "5x8-sent",
		});
		const preservedAssistant: Message = {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-read-1", name: "read", arguments: { path: "notes.txt" } }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "toolUse",
			usage: {
				input: 10,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 13,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};
		const preservedToolResult: Message = {
			role: "toolResult",
			toolCallId: "call-read-1",
			toolName: "read",
			content: [{ type: "text", text: "important tool output" }],
			isError: false,
			timestamp: Date.now(),
		};
		const filler = "the quick brown fox jumps over the lazy dog. ".repeat(64);
		for (let turn = 1; turn <= 70; turn++) {
			sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: `turn ${turn}: ${filler}` }],
				timestamp: Date.now(),
			});
			sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: `reply ${turn}: ${filler}` }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				stopReason: "stop",
				usage: {
					input: 1000,
					output: 1000,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2000,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				timestamp: Date.now(),
			});
		}
		sessionManager.appendMessage({ role: "user", content: "second request", timestamp: Date.now() });
		sessionManager.appendMessage(preservedAssistant);
		sessionManager.appendMessage(preservedToolResult);

		let foregroundCalls = 0;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			streamFn: () => {
				foregroundCalls++;
				const initialTurn = foregroundCalls === 1;
				const answer: AssistantMessage = {
					role: "assistant",
					content: [{ type: "text", text: "foreground terminal response" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					stopReason: "stop",
					usage: {
						input: initialTurn ? 9_000 : 1,
						output: initialTurn ? 100 : 2,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: initialTurn ? 9_100 : 3,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					timestamp: Date.now(),
				};
				const stream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: answer });
					stream.push({ type: "done", reason: "stop", message: answer });
				});
				return stream;
			},
		});
		session = new AgentSession({ agent, sessionManager, settings, modelRegistry: new ModelRegistry(authStorage) });
		const automatic = session.prompt("automatic threshold trigger");
		await withTimeout(
			automaticStarted.promise,
			1000,
			`automatic Codex V2 transport did not start (foregroundCalls=${foregroundCalls}, nativeCalls=${nativeCalls})`,
		);
		const abortPromise = session.abort({ reason: USER_INTERRUPT_LABEL });
		await withTimeout(abortPromise, 1000, "session abort did not settle");
		await withTimeout(
			automatic.catch(() => undefined),
			1000,
			"automatic prompt did not settle",
		);

		expect(nativeCompaction).toHaveBeenCalledTimes(1);
		expect(session.isCompacting).toBe(false);
		expect(sessionManager.getBranch().filter(entry => entry.type === "compaction")).toHaveLength(0);

		await withTimeout(session.compact(undefined, { mode: "snapcompact" }), 1000, "manual snapcompact did not settle");
		const afterManual = sessionManager.getBranch();
		expect(afterManual.filter(entry => entry.type === "compaction")).toHaveLength(1);
		expect(
			afterManual.some(
				entry =>
					entry.type === "message" &&
					entry.message.role === "toolResult" &&
					entry.message.content[0]?.type === "text" &&
					entry.message.content[0].text === "important tool output",
			),
		).toBe(true);

		session.settings.override("compaction.thresholdTokens", 150_000);
		await withTimeout(session.prompt("next foreground turn"), 1000, "foreground prompt did not settle");
		await session.waitForIdle();
		const afterForeground = sessionManager.getBranch();
		expect(foregroundCalls).toBe(1);
		expect(
			afterForeground.some(
				entry =>
					entry.type === "message" &&
					entry.message.role === "assistant" &&
					entry.message.content[0]?.type === "text" &&
					entry.message.content[0].text === "foreground terminal response",
			),
		).toBe(true);
		expect(afterForeground.filter(entry => entry.type === "compaction")).toHaveLength(1);
	}, 30_000);
});
