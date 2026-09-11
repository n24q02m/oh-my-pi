import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "bun:test";
import { readDaemonGitStatus } from "../../src/launch/git-status";

describe("daemon git status", () => {
	it("returns a structured bounded error for a missing worktree", async () => {
		const worktree = path.join(os.tmpdir(), `omp-git-status-missing-${crypto.randomUUID()}`);
		const result = await readDaemonGitStatus("missing", worktree, { refresh: true });
		expect(result.daemonName).toBe("missing");
		expect(result.worktreePath).toBe(path.resolve(worktree));
		expect(result.error?.code).toMatch(/^git-/u);
		expect(result.error?.message.length).toBeLessThanOrEqual(300);
	});
});
