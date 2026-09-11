import { describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import {
	collectPendingToolCalls,
	createInterruptedTurnAbortMessage,
	describePendingToolCalls,
	findLastSessionLiveness,
	SESSION_EXIT_CUSTOM_TYPE,
	SESSION_LIVENESS_CUSTOM_TYPE,
	type SessionLivenessData,
	TOOL_EXECUTION_START_CUSTOM_TYPE,
	type ToolExecutionStartData,
} from "@oh-my-pi/pi-coding-agent/session/exit-diagnostics";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

const pendingAssistant: AssistantMessage = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "toolu_repro",
			name: "bash",
			arguments: { command: "bun run check:ts" },
		},
	],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "mock",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse",
	timestamp: Date.now(),
};

describe("session exit diagnostics replay", () => {
	it("treats assistant tool calls as pending even when stopReason is not toolUse", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ ...pendingAssistant, stopReason: "stop" });

		expect(collectPendingToolCalls(sessionManager.getBranch())).toMatchObject([
			{
				toolCallId: "toolu_repro",
				toolName: "bash",
				args: { command: "bun run check:ts" },
			},
		]);
		expect(describePendingToolCalls(sessionManager.getBranch())).toContain("bun run check:ts");
	});

	it("clears the pending warning once the matching tool result is recorded", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendCustomEntry(TOOL_EXECUTION_START_CUSTOM_TYPE, {
			toolCallId: "toolu_repro",
			toolName: "bash",
			args: { command: "bun run check:ts" },
			startedAt: new Date().toISOString(),
		} satisfies ToolExecutionStartData);
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "toolu_repro",
			toolName: "bash",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: Date.now(),
		});

		expect(collectPendingToolCalls(sessionManager.getBranch())).toEqual([]);
		expect(describePendingToolCalls(sessionManager.getBranch())).toBeUndefined();
	});

	it("reconstructs an abnormal process-exit tail as one terminal aborted assistant message", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "toolu_repro",
			toolName: "bash",
			content: [{ type: "text", text: "partial result stays in history" }],
			isError: false,
			timestamp: Date.now(),
		});
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		const recovered = createInterruptedTurnAbortMessage(sessionManager.getBranch());
		expect(recovered).toMatchObject({
			role: "assistant",
			content: [],
			api: pendingAssistant.api,
			provider: pendingAssistant.provider,
			model: pendingAssistant.model,
			stopReason: "aborted",
		});
		expect(recovered?.errorMessage).toContain("process exited");
	});

	it("reconstructs a normal exit that reports pending tool calls", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "manual exit",
			kind: "normal",
			recordedAt: "2026-07-11T02:20:08.800Z",
			pendingToolCalls: [{ toolCallId: "toolu_repro", toolName: "bash" }],
		});

		expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toMatchObject({
			role: "assistant",
			stopReason: "aborted",
		});
	});

	it("ignores malformed pending tool diagnostics on normal exits", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "manual exit",
			kind: "normal",
			recordedAt: "2026-07-11T02:20:08.800Z",
			pendingToolCalls: "not an array",
		});

		expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toBeUndefined();
	});

	it("reconstructs an interrupted assistant tool-call tail", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toMatchObject({
			role: "assistant",
			content: [],
			api: pendingAssistant.api,
			provider: pendingAssistant.provider,
			model: pendingAssistant.model,
			stopReason: "aborted",
		});
	});

	it("reconstructs tool-call content even when stopReason is stop", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage({ ...pendingAssistant, stopReason: "stop" });
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toMatchObject({
			role: "assistant",
			stopReason: "aborted",
		});
	});

	it("does not reconstruct a failed tool turn already closed by synthetic results", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage({ ...pendingAssistant, stopReason: "error" });
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "toolu_repro",
			toolName: "bash",
			content: [{ type: "text", text: "Tool execution stopped after model failure." }],
			isError: true,
			timestamp: Date.now(),
		});
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toBeUndefined();
	});

	it("reconstructs a first user-message tail with selected model metadata", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		expect(
			createInterruptedTurnAbortMessage(sessionManager.getBranch(), {
				api: pendingAssistant.api,
				provider: pendingAssistant.provider,
				model: pendingAssistant.model,
			}),
		).toMatchObject({
			role: "assistant",
			api: pendingAssistant.api,
			provider: pendingAssistant.provider,
			model: pendingAssistant.model,
			stopReason: "aborted",
		});
	});

	it("does not reconstruct clean, completed, or superseded exits", () => {
		const normalExit = SessionManager.inMemory();
		normalExit.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		normalExit.appendMessage(pendingAssistant);
		normalExit.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "dispose",
			kind: "normal",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		const completedTurn = SessionManager.inMemory();
		completedTurn.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		completedTurn.appendMessage({
			...pendingAssistant,
			content: [{ type: "text", text: "done" }],
			stopReason: "stop",
		});
		completedTurn.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});

		const supersededExit = SessionManager.inMemory();
		supersededExit.appendMessage({ role: "user", content: "first turn", timestamp: Date.now() });
		supersededExit.appendMessage(pendingAssistant);
		supersededExit.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "exit",
			kind: "process_exit",
			recordedAt: "2026-07-11T02:20:08.800Z",
		});
		supersededExit.appendMessage({ role: "user", content: "new turn", timestamp: Date.now() });

		expect(createInterruptedTurnAbortMessage(normalExit.getBranch())).toBeUndefined();
		expect(createInterruptedTurnAbortMessage(completedTurn.getBranch())).toBeUndefined();
		expect(createInterruptedTurnAbortMessage(supersededExit.getBranch())).toBeUndefined();
	});

	it("reconstructs an unclosed liveness tail when the prior process outcome was not observable", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage(pendingAssistant);
		const liveness = {
			recordedAt: "2026-07-11T02:20:08.800Z",
			operationId: "toolu_repro",
			operation: "tool_execution",
			phase: "start",
			toolName: "bash",
		} satisfies SessionLivenessData;
		sessionManager.appendCustomEntry(SESSION_LIVENESS_CUSTOM_TYPE, liveness);

		const recovered = createInterruptedTurnAbortMessage(sessionManager.getBranch());

		expect(recovered).toMatchObject({
			role: "assistant",
			stopReason: "aborted",
		});
		expect(recovered?.errorMessage).toContain("could not be observed");
	});

	it("does not recover a completed tool operation as interrupted", () => {
		const sessionManager = SessionManager.inMemory();
		const operationId = "toolu_repro";
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendCustomEntry(SESSION_LIVENESS_CUSTOM_TYPE, {
			recordedAt: "2026-07-11T02:20:08.800Z",
			operation: "tool_execution",
			operationId,
			phase: "start",
			toolName: "bash",
		});
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "toolu_repro",
			toolName: "bash",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: Date.now(),
		});
		sessionManager.appendCustomEntry(SESSION_LIVENESS_CUSTOM_TYPE, {
			recordedAt: "2026-07-11T02:20:09.800Z",
			operation: "tool_execution",
			operationId,
			phase: "end",
			toolName: "bash",
		});

		expect(findLastSessionLiveness(sessionManager.getBranch())).toBeUndefined();
		expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toBeUndefined();
	});
});
