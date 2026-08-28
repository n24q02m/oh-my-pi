import { describe, expect, it } from "bun:test";
import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type PairingClaimResult, PairingStore, type PairingStoreOptions } from "../../src/launch/pairing-store";
import type { DaemonCapability } from "../../src/launch/protocol";

const observeOnly: DaemonCapability[] = ["observe"];
const allTestCapabilities: DaemonCapability[] = ["observe", "control-session", "approve", "manage-devices", "git-read"];

class TestTempDir {
	readonly #directory: string;

	private constructor(directory: string) {
		this.#directory = directory;
	}

	static createSync(prefix: string): TestTempDir {
		return new TestTempDir(nodeFs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	}

	path(): string {
		return this.#directory;
	}

	[Symbol.dispose](): void {
		nodeFs.rmSync(this.#directory, { recursive: true, force: true });
	}
}

function storeOptions(filePath: string, overrides: Partial<PairingStoreOptions> = {}): PairingStoreOptions {
	return {
		filePath,
		secret: "test-store-secret",
		...overrides,
	};
}

async function createStore(tempDir: TestTempDir, overrides: Partial<PairingStoreOptions> = {}): Promise<PairingStore> {
	const filePath = path.join(tempDir.path(), "pairing", "devices.json");
	const store = new PairingStore(storeOptions(filePath, overrides));
	await store.initialize();
	return store;
}

async function approvedClaim(
	store: PairingStore,
	name: string,
	capabilities: DaemonCapability[] = observeOnly,
): Promise<PairingClaimResult> {
	const pending = await store.begin(name, capabilities);
	await store.approve(pending.code);
	return store.claim(pending.code);
}

describe("capability-scoped pairing store", () => {
	it("keeps pending codes and device credentials hash-only on disk", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-store-");
		const filePath = path.join(tempDir.path(), "pairing", "devices.json");
		const store = new PairingStore(storeOptions(filePath));
		await store.initialize();

		const pending = await store.begin("tablet", allTestCapabilities);
		expect(pending.code.length).toBeGreaterThan(0);
		await store.approve(pending.code);
		const claimed = await store.claim(pending.code);
		const persisted = await fs.readFile(filePath, "utf8");

		expect(persisted).not.toContain(pending.code);
		expect(persisted).not.toContain(claimed.token);
		expect(persisted).toContain("tokenHash");
		expect(persisted).not.toContain("pending");
	});

	it("requires foreground approval and consumes a claim exactly once", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-approval-");
		const store = await createStore(tempDir);
		const pending = await store.begin("phone", observeOnly);

		await expect(store.claim(pending.code)).rejects.toThrow(/approval/i);
		const approval = await store.approve(pending.code);
		expect(approval.name).toBe("phone");
		const claimed = await store.claim(pending.code);
		expect(claimed.device.name).toBe("phone");
		await expect(store.claim(pending.code)).rejects.toThrow(/expired|used|unknown/i);
	});

	it("expires pending approvals without retaining an expired code", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-expiry-");
		let now = 10_000;
		const store = await createStore(tempDir, {
			now: () => now,
			pendingTtlMs: 100,
		});
		const pending = await store.begin("short-lived", observeOnly);
		await store.approve(pending.code);
		now += 101;
		await expect(store.claim(pending.code)).rejects.toThrow(/expired|unknown/i);
		expect(await store.pendingCount()).toBe(0);
	});

	it("rejects duplicate names and enforces bounded pending and device counts", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-bounds-");
		const store = await createStore(tempDir, { maxPending: 2, maxDevices: 2 });
		const first = await store.begin("same-name", observeOnly);
		await expect(store.begin("same-name", observeOnly)).rejects.toThrow(/already/i);
		const secondPending = await store.begin("second", observeOnly);
		await expect(store.begin("third", observeOnly)).rejects.toThrow(/pending|limit|capacity/i);
		await store.approve(first.code);
		await store.claim(first.code);
		await store.approve(secondPending.code);
		await store.claim(secondPending.code);
		await expect(approvedClaim(store, "third")).rejects.toThrow(/device|limit|capacity/i);
		expect((await store.list()).length).toBe(2);
	});

	it("recovers hash-only records after a restart and rotates atomically", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-restart-");
		const filePath = path.join(tempDir.path(), "pairing", "devices.json");
		const options = storeOptions(filePath);
		const firstStore = new PairingStore(options);
		await firstStore.initialize();
		const claimed = await approvedClaim(firstStore, "laptop", observeOnly);
		const beforeRotate = await firstStore.list();
		const secondStore = new PairingStore(options);
		await secondStore.initialize();
		expect(await secondStore.list()).toEqual(beforeRotate);

		const rotated = await secondStore.rotate(claimed.device.id);
		expect(rotated.token).not.toBe(claimed.token);
		await expect(secondStore.authenticate(claimed.token)).resolves.toBeUndefined();
		await expect(secondStore.authenticate(rotated.token)).resolves.toMatchObject({ id: claimed.device.id });
		const restarted = new PairingStore(options);
		await restarted.initialize();
		await expect(restarted.authenticate(claimed.token)).resolves.toBeUndefined();
		await expect(restarted.authenticate(rotated.token)).resolves.toMatchObject({ id: claimed.device.id });
	});

	it("serializes concurrent revoke and rotate without resurrecting a credential", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-race-");
		const filePath = path.join(tempDir.path(), "pairing", "devices.json");
		const store = await createStore(tempDir);
		const claimed = await approvedClaim(store, "race-device", observeOnly);

		await Promise.allSettled([store.revoke(claimed.device.id), store.rotate(claimed.device.id)]);
		expect(await store.list()).toEqual([]);
		await expect(store.authenticate(claimed.token)).resolves.toBeUndefined();
		const restarted = new PairingStore(storeOptions(filePath));
		await restarted.initialize();
		expect(await restarted.list()).toEqual([]);
	});

	it("fails closed on corrupt persistence", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-corrupt-");
		const filePath = path.join(tempDir.path(), "pairing", "devices.json");
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, "not-json", "utf8");
		const store = new PairingStore(storeOptions(filePath));
		await expect(store.initialize()).rejects.toThrow(/corrupt|invalid|persistence/i);
		await expect(store.begin("blocked", observeOnly)).rejects.toThrow(/corrupt|invalid|persistence/i);
	});

	it("fails closed when an atomic persistence write cannot complete", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-write-failure-");
		const blockedParent = path.join(tempDir.path(), "blocked");
		await fs.writeFile(blockedParent, "not-a-directory", "utf8");
		const store = new PairingStore(storeOptions(path.join(blockedParent, "devices.json")));
		await store.initialize();
		const pending = await store.begin("blocked-write", observeOnly);
		await store.approve(pending.code);
		await expect(store.claim(pending.code)).rejects.toThrow();
		await expect(store.list()).rejects.toThrow(/unavailable|write|persistence/i);
	});

	it("returns only metadata from list and never exposes token hashes", async () => {
		using tempDir = TestTempDir.createSync("@omp-pairing-metadata-");
		const store = await createStore(tempDir);
		await approvedClaim(store, "metadata-device", observeOnly);
		const listed = await store.list();
		expect(listed[0]).toMatchObject({ name: "metadata-device", capabilities: observeOnly });
		expect(listed[0]).not.toHaveProperty("tokenHash");
	});
});
