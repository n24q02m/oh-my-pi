import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	SESSION_EXIT_CUSTOM_TYPE,
	SESSION_LIVENESS_CUSTOM_TYPE,
	type SessionLivenessData,
} from "@oh-my-pi/pi-coding-agent/session/exit-diagnostics";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	recordAbnormalSessionExit,
	resolveSentinelSpawnCmd,
	runSessionExitSentinel,
} from "@oh-my-pi/pi-coding-agent/session/session-sentinel";
import {
	SESSION_SENTINEL_PARENT_PID_ENV,
	SESSION_SENTINEL_SESSION_FILE_ENV,
} from "@oh-my-pi/pi-coding-agent/session/session-sentinel-protocol";
import { TempDir } from "@oh-my-pi/pi-utils";

const liveness = {
	recordedAt: "2026-07-11T02:20:08.800Z",
	operationId: "retry-wait-1",
	operation: "retry_wait",
	phase: "wait",
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	watchdogMs: 1_000,
} satisfies SessionLivenessData;

function hasCompiledNativeAddon(): boolean {
	const dir = path.resolve(import.meta.dir, "../../natives/native");
	try {
		return fs.readdirSync(dir).some(file => file.endsWith(".node"));
	} catch {
		return false;
	}
}

describe("session exit sentinel replay", () => {
	it("records one abnormal sentinel exit for an unclosed liveness marker", async () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendCustomEntry(SESSION_LIVENESS_CUSTOM_TYPE, liveness);

		expect(await recordAbnormalSessionExit(sessionManager)).toBe(true);
		expect(await recordAbnormalSessionExit(sessionManager)).toBe(false);
		const exitEntry = sessionManager
			.getBranch()
			.find(entry => entry.type === "custom" && entry.customType === SESSION_EXIT_CUSTOM_TYPE);

		if (exitEntry?.type !== "custom") throw new Error("Expected abnormal session exit marker");
		expect(exitEntry.data).toMatchObject({
			reason: "parent_disappeared",
			kind: "abnormal",
			lastLiveness: liveness,
			processOutcome: {
				observation: "unknown",
				observedBy: "sentinel",
			},
		});
	});
	it("persists an unknown sentinel outcome after the parent disappears", async () => {
		const directory = TempDir.createSync("@pi-session-sentinel-");
		try {
			const sessionManager = SessionManager.create(directory.path(), directory.path());
			sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
			sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "working" }],
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
				stopReason: "stop",
				timestamp: Date.now(),
			});
			sessionManager.appendCustomEntry(SESSION_LIVENESS_CUSTOM_TYPE, {
				...liveness,
				operation: "provider_stream",
				operationId: "stream-1",
				phase: "start",
			});
			await sessionManager.flush();
			const sessionFile = sessionManager.getSessionFile();
			if (!sessionFile) throw new Error("Expected a session file");

			const recorded = await runSessionExitSentinel({
				sessionFile,
				parentPid: Number.MAX_SAFE_INTEGER,
				parentIsAlive: () => false,
			});
			expect(recorded).toBe(true);

			const reopened = await SessionManager.open(sessionFile);
			try {
				const exitEntry = reopened
					.getBranch()
					.find(entry => entry.type === "custom" && entry.customType === SESSION_EXIT_CUSTOM_TYPE);
				if (exitEntry?.type !== "custom") throw new Error("Expected persisted sentinel exit marker");
				expect(exitEntry.data).toMatchObject({
					reason: "parent_disappeared",
					kind: "abnormal",
					processOutcome: { observation: "unknown", observedBy: "sentinel" },
				});
			} finally {
				await reopened.flush();
			}
		} finally {
			directory.removeSync();
		}
	});

	it("rejects a non-positive parent PID without touching the session", async () => {
		await expect(runSessionExitSentinel({ sessionFile: "missing.jsonl", parentPid: 0 })).rejects.toThrow(
			"positive parent PID",
		);
	});

	it.skipIf(!hasCompiledNativeAddon())(
		"records an abnormal outcome through the real CLI sentinel worker",
		async () => {
			const directory = TempDir.createSync("@pi-session-sentinel-worker-");
			try {
				const sessionManager = SessionManager.create(directory.path(), directory.path());
				sessionManager.appendMessage({ role: "user", content: "inspect the file", timestamp: Date.now() });
				sessionManager.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: "working" }],
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
					stopReason: "stop",
					timestamp: Date.now(),
				});
				sessionManager.appendCustomEntry(SESSION_LIVENESS_CUSTOM_TYPE, {
					...liveness,
					operation: "provider_stream",
					operationId: "provider-1",
					phase: "start",
				});
				await sessionManager.flush();
				const sessionFile = sessionManager.getSessionFile();
				if (!sessionFile) throw new Error("Expected a persisted session file");

				const watchedParent = Bun.spawn([process.execPath, "-e", "process.stdin.resume()"], {
					stdin: "pipe",
					stdout: "ignore",
					stderr: "ignore",
				});
				const workerCmd = resolveSentinelSpawnCmd();
				const worker = Bun.spawn(workerCmd, {
					env: {
						...process.env,
						[SESSION_SENTINEL_PARENT_PID_ENV]: String(watchedParent.pid),
						[SESSION_SENTINEL_SESSION_FILE_ENV]: sessionFile,
					},
					stdin: "ignore",
					stdout: "ignore",
					stderr: "ignore",
				});
				try {
					watchedParent.kill();
					await watchedParent.exited;
					expect(await worker.exited).toBe(0);
				} finally {
					try {
						watchedParent.kill();
					} catch {}
					try {
						worker.kill();
					} catch {}
					await Promise.all([watchedParent.exited, worker.exited]);
				}

				const reopened = await SessionManager.open(sessionFile, directory.path());
				try {
					const exitEntry = reopened
						.getBranch()
						.find(entry => entry.type === "custom" && entry.customType === SESSION_EXIT_CUSTOM_TYPE);
					if (exitEntry?.type !== "custom") throw new Error("Expected CLI sentinel exit marker");
					expect(exitEntry.data).toMatchObject({
						kind: "abnormal",
						processOutcome: { observation: "unknown", observedBy: "sentinel" },
					});
				} finally {
					await reopened.flush();
				}
			} finally {
				directory.removeSync();
			}
		},
	);
});
