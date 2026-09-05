import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runBoundedGitCommand } from "@oh-my-pi/pi-coding-agent/utils/git-command";
import type { Subprocess } from "bun";

type SpawnOptions = Parameters<typeof Bun.spawn>[1];
type SpawnCall = {
	cmd: string[];
	options: SpawnOptions;
};

const encoder = new TextEncoder();

const createStream = (text: string): ReadableStream<Uint8Array> =>
	new ReadableStream({
		start(controller) {
			if (text.length > 0) {
				controller.enqueue(encoder.encode(text));
			}
			controller.close();
		},
	});

const createFakeProcess = (value: { exitCode: number; stdout: string; stderr: string }): Subprocess =>
	({
		stdout: createStream(value.stdout),
		stderr: createStream(value.stderr),
		exited: Promise.resolve(value.exitCode),
	}) as unknown as Subprocess;

describe("runBoundedGitCommand", () => {
	const originalSpawn = Bun.spawn;
	let spawnCalls: SpawnCall[] = [];

	beforeEach(() => {
		spawnCalls = [];
		Bun.spawn = ((cmd: string[] | string, options: SpawnOptions = {}): Subprocess => {
			const normalizedCmd = Array.isArray(cmd) ? cmd : [cmd];
			spawnCalls.push({ cmd: normalizedCmd, options: options ?? {} });
			return createFakeProcess({
				exitCode: 0,
				stdout: "ok\n",
				stderr: "",
			});
		}) as typeof Bun.spawn;
	});

	afterEach(() => {
		Bun.spawn = originalSpawn;
	});

	it("returns bounded output and metadata", async () => {
		const result = await runBoundedGitCommand(["status", "--porcelain"], { cwd: "/repo" });

		expect(result).toMatchObject({
			exitCode: 0,
			stdout: "ok\n",
			stderr: "",
			stdoutTruncated: false,
			stderrTruncated: false,
		});
		expect(spawnCalls).toHaveLength(1);
		const firstCall = spawnCalls[0];
		expect(firstCall?.options?.cwd).toBe("/repo");
	});

	it("reports truncated output when stdout exceeds max bytes", async () => {
		Bun.spawn = ((cmd: string[] | string, options: SpawnOptions = {}): Subprocess => {
			spawnCalls.push({ cmd: Array.isArray(cmd) ? cmd : [cmd], options: options ?? {} });
			return createFakeProcess({
				exitCode: 0,
				stdout: "ABCDEFG",
				stderr: "",
			});
		}) as typeof Bun.spawn;

		const result = await runBoundedGitCommand(["status"], { maxStdoutBytes: 2 });

		expect(result.stdout).toBe("AB");
		expect(result.stdoutTruncated).toBe(true);
	});

	it("returns ENOENT as a non-fatal command result", async () => {
		Bun.spawn = (() => {
			const error = new Error("No such file or directory");
			(error as NodeJS.ErrnoException).code = "ENOENT";
			throw error;
		}) as typeof Bun.spawn;

		const result = await runBoundedGitCommand(["status"]);

		expect(result.exitCode).toBe(127);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Failed to execute git command");
	});
});
