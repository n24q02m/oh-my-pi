import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { startDaemonBrokerFromEnvironment } from "../../src/launch/broker";
import { createDaemonBrokerClient, type DaemonBrokerClient } from "../../src/launch/client";
import type { DaemonCapability, DaemonOperation } from "../../src/launch/protocol";
import { DAEMON_IDLE_GRACE_ENV, DAEMON_PROJECT_DIR_ENV, DAEMON_RUNTIME_DIR_ENV } from "../../src/launch/protocol";

class TestTempDir {
	readonly #directory: string;

	private constructor(directory: string) {
		this.#directory = directory;
	}

	static createSync(prefix: string): TestTempDir {
		return new TestTempDir(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	}

	path(): string {
		return this.#directory;
	}

	[Symbol.dispose](): void {
		fs.rmSync(this.#directory, { recursive: true, force: true });
	}
}

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function startBroker(projectDir: string, runtimeDir: string, idleGraceMs = 5_000): Promise<void> {
	const previousProjectDir = process.env[DAEMON_PROJECT_DIR_ENV];
	const previousRuntimeDir = process.env[DAEMON_RUNTIME_DIR_ENV];
	const previousGrace = process.env[DAEMON_IDLE_GRACE_ENV];
	process.env[DAEMON_PROJECT_DIR_ENV] = projectDir;
	process.env[DAEMON_RUNTIME_DIR_ENV] = runtimeDir;
	process.env[DAEMON_IDLE_GRACE_ENV] = String(idleGraceMs);
	const broker = startDaemonBrokerFromEnvironment();
	restoreEnvironment(DAEMON_PROJECT_DIR_ENV, previousProjectDir);
	restoreEnvironment(DAEMON_RUNTIME_DIR_ENV, previousRuntimeDir);
	restoreEnvironment(DAEMON_IDLE_GRACE_ENV, previousGrace);
	return broker;
}

async function beginAndClaim(
	admin: DaemonBrokerClient,
	name: string,
	capabilities: DaemonCapability[],
): Promise<{ id: string; token: string }> {
	const begun = await admin.request({ op: "pair-begin", name, capabilities });
	if (begun.op !== "pair-begin") throw new Error("unexpected pairing begin result");
	await admin.request({ op: "pair-approve", code: begun.code });
	const claimed = await admin.request({ op: "pair-claim", code: begun.code });
	if (claimed.op !== "pair-claim") throw new Error("unexpected pairing claim result");
	return { id: claimed.device.id, token: claimed.token };
}

describe("daemon broker capability-scoped pairing", () => {
	it("requires approval, returns a claim token once, and keeps broker persistence hash-only", async () => {
		using tempDir = TestTempDir.createSync("@omp-broker-pairing-");
		const projectDir = path.join(tempDir.path(), "project");
		const runtimeDir = path.join(tempDir.path(), "runtime");
		await fsPromises.mkdir(projectDir, { recursive: true });
		const admin = await createDaemonBrokerClient(projectDir, { runtimeDir });
		const broker = startBroker(projectDir, runtimeDir);
		try {
			const begun = await admin.request({ op: "pair-begin", name: "observer", capabilities: ["observe"] });
			if (begun.op !== "pair-begin") throw new Error("unexpected pairing begin result");
			await expect(admin.request({ op: "pair-claim", code: begun.code })).rejects.toThrow(/approval/i);
			await admin.request({ op: "pair-approve", code: begun.code });
			const claimed = await admin.request({ op: "pair-claim", code: begun.code });
			if (claimed.op !== "pair-claim") throw new Error("unexpected pairing claim result");
			await expect(admin.request({ op: "pair-claim", code: begun.code })).rejects.toThrow(/used|unknown|expired/i);

			const persisted = await fsPromises.readFile(path.join(runtimeDir, "paired-devices.json"), "utf8");
			expect(persisted).not.toContain(begun.code);
			expect(persisted).not.toContain(claimed.token);
			expect(persisted).toContain("tokenHash");
		} finally {
			await admin.request({ op: "shutdown" }).catch(() => undefined);
			admin.close();
			await broker.catch(() => undefined);
		}
	});

	it("denies every control, approval, and device-management operation to an observe-only token before dispatch", async () => {
		using tempDir = TestTempDir.createSync("@omp-broker-capability-");
		const projectDir = path.join(tempDir.path(), "project");
		const runtimeDir = path.join(tempDir.path(), "runtime");
		await fsPromises.mkdir(projectDir, { recursive: true });
		const admin = await createDaemonBrokerClient(projectDir, { runtimeDir });
		const broker = startBroker(projectDir, runtimeDir);
		let observer: DaemonBrokerClient | undefined;
		try {
			const claimed = await beginAndClaim(admin, "observer", ["observe"]);
			observer = await createDaemonBrokerClient(projectDir, { runtimeDir, token: claimed.token });
			expect((await observer.request({ op: "list" })).op).toBe("list");

			const startSpec = {
				name: "must-not-start",
				application: process.execPath,
				args: ["-e", "setTimeout(() => {}, 1)"],
				env: {},
				cwd: projectDir,
				pty: false,
				restart: "no" as const,
				persist: false,
				detached: false,
			};
			const denied: DaemonOperation[] = [
				{ op: "start", spec: startSpec },
				{ op: "stop", name: "missing", timeoutMs: 1 },
				{ op: "send", name: "missing", data: "input" },
				{ op: "pair-approve", code: crypto.randomUUID() },
				{ op: "pair-begin", name: "blocked", capabilities: ["observe"] },
				{ op: "pair-list" },
				{ op: "pair-revoke", id: claimed.id },
				{ op: "pair-rotate", id: claimed.id },
			];
			for (const operation of denied)
				await expect(observer.request(operation)).rejects.toThrow(/capability|authorization|permission/i);
			const listed = await admin.request({ op: "pair-list" });
			if (listed.op !== "pair-list") throw new Error("unexpected pairing list result");
			expect(listed.devices).toHaveLength(1);
		} finally {
			observer?.close();
			await admin.request({ op: "shutdown" }).catch(() => undefined);
			admin.close();
			await broker.catch(() => undefined);
		}
	});

	it("recovers paired records after broker restart and invalidates a revoked token", async () => {
		using tempDir = TestTempDir.createSync("@omp-broker-pairing-restart-");
		const projectDir = path.join(tempDir.path(), "project");
		const runtimeDir = path.join(tempDir.path(), "runtime");
		await fsPromises.mkdir(projectDir, { recursive: true });
		const admin = await createDaemonBrokerClient(projectDir, { runtimeDir });
		const firstBroker = startBroker(projectDir, runtimeDir, 100);
		const claimed = await beginAndClaim(admin, "restart-observer", ["observe"]);
		const paired = await createDaemonBrokerClient(projectDir, { runtimeDir, token: claimed.token });
		await admin.request({ op: "shutdown" });
		await firstBroker;
		admin.close();
		paired.close();

		const recoveredAdmin = await createDaemonBrokerClient(projectDir, { runtimeDir });
		const secondBroker = startBroker(projectDir, runtimeDir, 100);
		let recoveredPaired: DaemonBrokerClient | undefined;
		try {
			recoveredPaired = await createDaemonBrokerClient(projectDir, { runtimeDir, token: claimed.token });
			expect((await recoveredPaired.request({ op: "list" })).op).toBe("list");
			await recoveredAdmin.request({ op: "pair-revoke", id: claimed.id });
			await expect(recoveredPaired.request({ op: "list" })).rejects.toThrow(/authentication|revoked|authorization/i);
		} finally {
			recoveredPaired?.close();
			await recoveredAdmin.request({ op: "shutdown" }).catch(() => undefined);
			recoveredAdmin.close();
			await secondBroker.catch(() => undefined);
		}
	});
	it("requires approve capability to preview and deny only a pending enrollment", async () => {
		using tempDir = TestTempDir.createSync("@omp-broker-pairing-preview-deny-");
		const projectDir = path.join(tempDir.path(), "project");
		const runtimeDir = path.join(tempDir.path(), "runtime");
		await fsPromises.mkdir(projectDir, { recursive: true });
		const admin = await createDaemonBrokerClient(projectDir, { runtimeDir });
		const broker = startBroker(projectDir, runtimeDir);
		let approver: DaemonBrokerClient | undefined;
		try {
			const approverClaim = await beginAndClaim(admin, "approver", ["approve"]);
			approver = await createDaemonBrokerClient(projectDir, { runtimeDir, token: approverClaim.token });
			const begun = await admin.request({
				op: "pair-begin",
				name: "pending",
				capabilities: ["observe", "git-read"],
			});
			if (begun.op !== "pair-begin") throw new Error("unexpected pairing begin result");

			const preview = await approver.request({ op: "pair-preview", code: begun.code });
			if (preview.op !== "pair-preview") throw new Error("unexpected pairing preview result");
			expect(preview).toMatchObject({ name: "pending", capabilities: ["observe", "git-read"] });
			expect(preview).not.toHaveProperty("code");
			expect(preview).not.toHaveProperty("token");

			const denied = await approver.request({ op: "pair-deny", code: begun.code });
			expect(denied).toMatchObject({ op: "pair-deny", name: "pending" });
			await expect(admin.request({ op: "pair-claim", code: begun.code })).rejects.toThrow(/unknown|expired/i);
		} finally {
			approver?.close();
			await admin.request({ op: "shutdown" }).catch(() => undefined);
			admin.close();
			await broker.catch(() => undefined);
		}
	});
});
