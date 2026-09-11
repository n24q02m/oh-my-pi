import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthCredentialStore, AuthStorage } from "@oh-my-pi/pi-ai";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession, type ExtensionFactory } from "@oh-my-pi/pi-coding-agent/sdk";
import {
	createInterruptedTurnAbortMessage,
	SESSION_EXIT_CUSTOM_TYPE,
} from "@oh-my-pi/pi-coding-agent/session/exit-diagnostics";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake } from "@oh-my-pi/pi-utils";

describe("createAgentSession deferred model pattern resolution", () => {
	let tempDir: string;
	let authStore: AuthCredentialStore;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-sdk-model-selection-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		authStore = new AuthCredentialStore(new Database(":memory:"));
	});

	afterEach(() => {
		authStore.close();
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	const providerExtension: ExtensionFactory = pi => {
		pi.registerProvider("runtime-provider", {
			baseUrl: "https://runtime.example.com/v1",
			apiKey: "RUNTIME_KEY",
			api: "openai-completions",
			models: [
				{
					id: "runtime-model",
					name: "Runtime Model",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 8192,
				},
			],
		});
	};

	function buildSessionOptions(modelPattern: string) {
		return {
			cwd: tempDir,
			agentDir: tempDir,
			authStorage: new AuthStorage(authStore),
			settings: Settings.isolated(),
			sessionManager: SessionManager.inMemory(),
			disableExtensionDiscovery: true,
			extensions: [providerExtension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			modelPattern,
		};
	}

	test("resolves explicit modelPattern after extension providers register", async () => {
		const { session, modelFallbackMessage } = await createAgentSession(
			buildSessionOptions("runtime-provider/runtime-model"),
		);

		try {
			expect(session.model).toBeDefined();
			expect(session.model?.provider).toBe("runtime-provider");
			expect(session.model?.id).toBe("runtime-model");
			expect(modelFallbackMessage).toBeUndefined();
		} finally {
			await session.dispose();
		}
	});

	test("does not silently fallback when explicit modelPattern is unresolved", async () => {
		const { session, modelFallbackMessage } = await createAgentSession(
			buildSessionOptions("missing-provider/missing-model"),
		);

		try {
			expect(session.model).toBeUndefined();
			expect(modelFallbackMessage).toBe('Model "missing-provider/missing-model" not found');
		} finally {
			await session.dispose();
		}
	});

	test("closes an interrupted persisted tail before restoring the agent", async () => {
		const sessionManager = SessionManager.create(tempDir, tempDir);
		sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
		sessionManager.appendCustomEntry(SESSION_EXIT_CUSTOM_TYPE, {
			reason: "parent_disappeared",
			kind: "abnormal",
			recordedAt: new Date().toISOString(),
			processOutcome: { observation: "unknown", observedBy: "sentinel" },
		});

		const { session } = await createAgentSession({
			...buildSessionOptions("runtime-provider/runtime-model"),
			sessionManager,
		});
		try {
			expect(session.messages).toHaveLength(2);
			expect(session.messages[1]).toMatchObject({
				role: "assistant",
				stopReason: "aborted",
				api: "openai-completions",
				provider: "runtime-provider",
				model: "runtime-model",
			});
			expect(
				sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "assistant"),
			).toHaveLength(1);
			expect(createInterruptedTurnAbortMessage(sessionManager.getBranch())).toBeUndefined();
		} finally {
			await session.dispose();
		}
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Expected recovered session to be persisted");
		const reopened = await SessionManager.open(sessionFile, tempDir);
		const { session: resumed } = await createAgentSession({
			...buildSessionOptions("runtime-provider/runtime-model"),
			sessionManager: reopened,
		});
		try {
			expect(resumed.messages.filter(message => message.role === "assistant")).toHaveLength(1);
			expect(resumed.messages[1]).toMatchObject({ role: "assistant", stopReason: "aborted" });
		} finally {
			await resumed.dispose();
		}
	});
});
