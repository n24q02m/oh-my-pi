import { describe, expect, it } from "bun:test";
import { isSubcommand, resolveCliArgv } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { formatPairingUri, type PairingCommandClient, parsePairingUri, runPairCommand } from "../../src/cli/pair-cli";
import type { DaemonOperation, DaemonRpcResult, PairedDeviceMetadata } from "../../src/launch/protocol";

const fingerprint256 = "a".repeat(64);
const endpoint = "tls://daemon.example.test:443";
const pairingCode = "one-time-pairing-code";
const deviceToken = "persistent-device-token";
const brokerToken = "broker-secret-must-never-leak";

const device: PairedDeviceMetadata = {
	id: "device-1",
	name: "tablet",
	capabilities: ["observe"],
	createdAt: 100,
};

const pending: Extract<DaemonRpcResult, { op: "pair-preview" }> = {
	op: "pair-preview",
	name: "tablet",
	capabilities: ["observe"],
	createdAt: 100,
	expiresAt: 600,
};

class FakePairingClient implements PairingCommandClient {
	readonly requests: DaemonOperation[] = [];
	#responses: DaemonRpcResult[];

	constructor(responses: DaemonRpcResult[]) {
		this.#responses = responses;
	}

	async request(operation: DaemonOperation): Promise<DaemonRpcResult> {
		this.requests.push(operation);
		const response = this.#responses.shift();
		if (!response) throw new Error(`Unexpected pairing operation ${operation.op}`);
		return response;
	}
}

function collectOutput(): { lines: string[]; write: (text: string) => void } {
	const lines: string[] = [];
	return { lines, write: text => lines.push(text) };
}

describe("pairing CLI URI", () => {
	it("round-trips endpoint metadata and one-time code without broker credentials", () => {
		const uri = formatPairingUri(
			{ transport: "tls", host: "daemon.example.test", port: 443, fingerprint256 },
			pairingCode,
		);

		expect(uri).toContain(pairingCode);
		expect(uri).toContain(fingerprint256);
		expect(uri).not.toContain(brokerToken);
		expect(parsePairingUri(uri)).toEqual({
			code: pairingCode,
			target: { transport: "tls", host: "daemon.example.test", port: 443, fingerprint256 },
		});
	});

	it("rejects non-loopback TCP targets and unexpected URI credentials", () => {
		expect(() =>
			parsePairingUri("omp://pair?endpoint=tcp%3A%2F%2F192.168.1.20%3A43123&code=one-time-pairing-code"),
		).toThrow(/loopback/i);
		expect(() =>
			parsePairingUri(`omp://pair?endpoint=${encodeURIComponent(endpoint)}&code=${pairingCode}&token=x`),
		).toThrow(/unexpected|token/i);
	});
});

describe("pairing CLI operations", () => {
	it("defaults begin to observe, prints only direct enrollment credentials, and renders a QR", async () => {
		const client = new FakePairingClient([
			{
				op: "pair-begin",
				code: pairingCode,
				name: "tablet",
				capabilities: ["observe"],
				createdAt: 100,
				expiresAt: 600,
			},
		]);
		const output = collectOutput();

		await runPairCommand(
			{ action: "begin", name: "tablet", endpoint, fingerprint256 },
			{ client, writeStdout: output.write, renderQr: () => ["QR"] },
		);

		expect(client.requests).toEqual([
			{ op: "pair-begin", name: "tablet", capabilities: ["observe"], ttlMs: undefined },
		]);
		expect(output.lines.join("\n")).toContain(pairingCode);
		expect(output.lines.join("\n")).toContain("QR");
		expect(output.lines.join("\n")).not.toContain(brokerToken);
	});

	it("keeps pairing codes and device tokens out of list output", async () => {
		const client = new FakePairingClient([{ op: "pair-list", devices: [device] }]);
		const output = collectOutput();

		await runPairCommand({ action: "list" }, { client, writeStdout: output.write });

		const text = output.lines.join("\n");
		expect(text).toContain("tablet");
		expect(text).not.toContain(pairingCode);
		expect(text).not.toContain(deviceToken);
		expect(text).not.toContain(brokerToken);
	});

	it("requires a foreground TTY and explicit confirmation before approving or denying", async () => {
		const blocked = new FakePairingClient([]);
		await expect(
			runPairCommand(
				{ action: "approve", code: pairingCode },
				{ client: blocked, stdinIsTTY: false, stdoutIsTTY: false },
			),
		).rejects.toThrow(/TTY|foreground|interactive/i);
		expect(blocked.requests).toEqual([]);

		const declined = new FakePairingClient([pending]);
		await runPairCommand(
			{ action: "deny", code: pairingCode },
			{
				client: declined,
				stdinIsTTY: true,
				stdoutIsTTY: true,
				writeStdout: () => undefined,
				confirm: async () => false,
			},
		);
		expect(declined.requests).toEqual([{ op: "pair-preview", code: pairingCode }]);

		const denied = new FakePairingClient([pending, { ...pending, op: "pair-deny" }]);
		await runPairCommand(
			{ action: "deny", code: pairingCode },
			{
				client: denied,
				stdinIsTTY: true,
				stdoutIsTTY: true,
				writeStdout: () => undefined,
				confirm: async () => true,
			},
		);
		expect(denied.requests).toEqual([
			{ op: "pair-preview", code: pairingCode },
			{ op: "pair-deny", code: pairingCode },
		]);

		const approved = new FakePairingClient([pending, { ...pending, op: "pair-approve", approvedAt: 120 }]);
		await runPairCommand(
			{ action: "approve", code: pairingCode },
			{
				client: approved,
				stdinIsTTY: true,
				stdoutIsTTY: true,
				writeStdout: () => undefined,
				confirm: async () => true,
			},
		);
		expect(approved.requests).toEqual([
			{ op: "pair-preview", code: pairingCode },
			{ op: "pair-approve", code: pairingCode },
		]);
	});
	it("validates capability and timeout boundaries before sending a begin request", async () => {
		const client = new FakePairingClient([]);
		await expect(
			runPairCommand({ action: "begin", name: "tablet", endpoint, capabilities: ["not-a-capability"] }, { client }),
		).rejects.toThrow(/capability/i);
		await expect(runPairCommand({ action: "begin", name: "tablet", endpoint, ttlMs: 0 }, { client })).rejects.toThrow(
			/ttl|timeout/i,
		);
		expect(client.requests).toEqual([]);
	});

	it("routes claim, revoke, and rotate without leaking credentials from revoke", async () => {
		const client = new FakePairingClient([
			{ op: "pair-claim", device, token: deviceToken },
			{ op: "pair-revoke", id: device.id },
			{ op: "pair-rotate", device, token: `${deviceToken}-rotated` },
		]);
		const output = collectOutput();
		const uri = formatPairingUri(
			{ transport: "tls", host: "daemon.example.test", port: 443, fingerprint256 },
			pairingCode,
		);

		await runPairCommand({ action: "claim", uri }, { client, writeStdout: output.write });
		const revokeOutputStart = output.lines.length;
		await runPairCommand({ action: "revoke", id: device.id }, { client, writeStdout: output.write });
		const revokeOutput = output.lines.slice(revokeOutputStart).join("\n");
		expect(revokeOutput).not.toContain(deviceToken);
		await runPairCommand({ action: "rotate", id: device.id }, { client, writeStdout: output.write });

		expect(client.requests).toEqual([
			{ op: "pair-claim", code: pairingCode },
			{ op: "pair-revoke", id: device.id },
			{ op: "pair-rotate", id: device.id },
		]);
		expect(output.lines.join("\n")).toContain(`${deviceToken}-rotated`);
	});
});

describe("pair command routing", () => {
	it("routes pair actions to the registered CLI command instead of launch", () => {
		expect(isSubcommand("pair")).toBe(true);
		expect(resolveCliArgv(["pair", "list"])).toEqual({ argv: ["pair", "list"] });
	});
});
