import { afterEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import {
	SESSION_LIVENESS_CUSTOM_TYPE,
	type SessionLivenessData,
} from "@oh-my-pi/pi-coding-agent/session/exit-diagnostics";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createTools, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

function assistantFixture(model: { provider: string; id: string }, text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function textStream(model: { provider: string; id: string }, text: string): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message = assistantFixture(model, text);
	stream.push({ type: "start", partial: message });
	stream.push({ type: "text_start", contentIndex: 0, partial: message });
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
	stream.push({ type: "done", reason: "stop", message });
	return stream;
}

function errorStream(model: { provider: string; id: string }, errorMessage: string): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
	stream.push({ type: "error", reason: "error", error: message });
	return stream;
}

function livenessEntries(sessionManager: SessionManager): SessionLivenessData[] {
	return sessionManager
		.getBranch()
		.filter(entry => entry.type === "custom" && entry.customType === SESSION_LIVENESS_CUSTOM_TYPE)
		.map(entry => (entry.type === "custom" ? (entry.data as SessionLivenessData) : undefined))
		.filter((data): data is SessionLivenessData => data !== undefined);
}

describe("session liveness replay", () => {
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	async function setup() {
		authStorage = await AuthStorage.create(":memory:");
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
	}

	afterEach(async () => {
		if (session) {
			await session.dispose();
			session = undefined;
		}
	});

	it("records provider stream start and end around a text turn", async () => {
		await setup();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic test model to exist");
		const agent = new Agent({
			getApiKey: () => "anthropic-test-key",
			initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
			streamFn: () => textStream(model, "hello"),
		});
		const sessionManager = SessionManager.inMemory();
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated(),
			modelRegistry,
			startSessionExitSentinel: () => undefined,
		});

		await session.prompt("Say hello");
		await session.waitForIdle();

		const entries = livenessEntries(sessionManager);
		const starts = entries.filter(entry => entry.operation === "provider_stream" && entry.phase === "start");
		const ends = entries.filter(entry => entry.operation === "provider_stream" && entry.phase === "end");
		expect(starts).toHaveLength(1);
		expect(ends).toHaveLength(1);
		expect(ends[0].operationId).toBe(starts[0].operationId);
		expect(starts[0]).toMatchObject({ provider: model.provider, model: model.id });
	});

	it("records retry wait and end across a transient rate limit", async () => {
		await setup();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic test model to exist");
		let calls = 0;
		const agent = new Agent({
			getApiKey: () => "anthropic-test-key",
			initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
			streamFn: () => {
				calls += 1;
				if (calls === 1) {
					return errorStream(model, "429 Rate limit exceeded, too many requests");
				}
				return textStream(model, "recovered");
			},
		});
		const sessionManager = SessionManager.inMemory();
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({
				"compaction.enabled": false,
				"retry.baseDelayMs": 5,
				"retry.maxRetries": 1,
			}),
			modelRegistry,
			startSessionExitSentinel: () => undefined,
		});

		await session.prompt("Trigger transient rate limit");
		await session.waitForIdle();

		expect(calls).toBe(2);
		const entries = livenessEntries(sessionManager);
		expect(entries).toContainEqual(
			expect.objectContaining({ operation: "retry_wait", phase: "wait", watchdogMs: 5 }),
		);
		expect(entries).toContainEqual(expect.objectContaining({ operation: "retry_wait", phase: "end" }));
	});

	it("records tool execution start and end for a tool turn", async () => {
		await setup();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic test model to exist");
		const toolSession: ToolSession = {
			cwd: os.tmpdir(),
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated(),
		};
		const tools = await createTools(toolSession);
		const toolMessage = {
			...assistantFixture(model, ""),
			content: [
				{
					type: "toolCall",
					id: "toolu_liveness",
					name: "bash",
					arguments: { command: "echo liveness-probe" },
				},
			],
			stopReason: "toolUse",
		} as AssistantMessage;
		let turn = 0;
		const agent = new Agent({
			getApiKey: () => "anthropic-test-key",
			initialState: { model, systemPrompt: "Test", tools, messages: [] },
			streamFn: () => {
				turn += 1;
				if (turn === 1) {
					const stream = new AssistantMessageEventStream();
					stream.push({ type: "start", partial: toolMessage });
					stream.push({ type: "toolcall_start", contentIndex: 0, partial: toolMessage });
					stream.push({
						type: "toolcall_end",
						contentIndex: 0,
						toolCall: {
							type: "toolCall",
							id: "toolu_liveness",
							name: "bash",
							arguments: { command: "echo liveness-probe" },
						},
						partial: toolMessage,
					});
					stream.push({ type: "done", reason: "toolUse", message: toolMessage });
					return stream;
				}
				return textStream(model, "done with tool");
			},
		});
		const sessionManager = SessionManager.inMemory();
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated(),
			modelRegistry,
			startSessionExitSentinel: () => undefined,
		});

		await session.prompt("Run a trivial command");
		await session.waitForIdle();

		const entries = livenessEntries(sessionManager);
		expect(entries).toContainEqual(
			expect.objectContaining({ operation: "tool_execution", operationId: "toolu_liveness", phase: "start" }),
		);
		expect(entries).toContainEqual(
			expect.objectContaining({ operation: "tool_execution", operationId: "toolu_liveness", phase: "end" }),
		);
	});
});
