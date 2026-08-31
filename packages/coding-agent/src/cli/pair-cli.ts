import * as readline from "node:readline/promises";
import { prompt } from "@oh-my-pi/pi-utils";
import {
	type DaemonCapability,
	type DaemonNativeRemoteTarget,
	type DaemonOperation,
	type DaemonRpcResult,
	type PairingPendingMetadata,
	parseDaemonCapabilities,
	parseDaemonNativeRemoteTarget,
} from "../launch/protocol";
import pairConfirmationPrompt from "../prompts/pair-confirmation.md" with { type: "text" };
import { QrCode, renderQrHalfBlocks } from "../utils/qrcode";

const MAX_PAIRING_TTL_MS = 15 * 60 * 1_000;

export type PairAction = "begin" | "approve" | "deny" | "claim" | "list" | "revoke" | "rotate";

export interface PairCommandArgs {
	action: PairAction;
	name?: string;
	endpoint?: string;
	fingerprint256?: string;
	capabilities?: readonly string[];
	ttlMs?: number;
	code?: string;
	uri?: string;
	id?: string;
}

export interface PairingCommandClient {
	request(operation: DaemonOperation): Promise<DaemonRpcResult>;
}

export interface PairingCommandDependencies {
	client: PairingCommandClient;
	stdinIsTTY?: boolean;
	stdoutIsTTY?: boolean;
	writeStdout?: (text: string) => void;
	confirm?: (pending: PairingPendingMetadata, action: "approve" | "deny") => Promise<boolean>;
	renderQr?: (uri: string) => string[];
}

export interface ParsedPairingUri {
	code: string;
	target: DaemonNativeRemoteTarget;
}

function requireValue(value: string | undefined, label: string): string {
	if (value === undefined || value.length === 0 || value.trim() !== value || /[\u0000-\u0020\u007f]/u.test(value)) {
		throw new Error(`Pairing ${label} is required`);
	}
	return value;
}

function endpointUrl(target: DaemonNativeRemoteTarget): string {
	const host = target.host.includes(":") ? `[${target.host}]` : target.host;
	return `${target.transport}://${host}:${target.port}`;
}

function parsedTarget(endpoint: string, fingerprint256: string | undefined): DaemonNativeRemoteTarget {
	const target = parseDaemonNativeRemoteTarget(endpoint);
	if (fingerprint256 === undefined) return target;
	return parseDaemonNativeRemoteTarget({ ...target, fingerprint256 });
}

function exactParameter(uri: URL, name: string): string {
	const values = uri.searchParams.getAll(name);
	if (values.length !== 1) throw new Error(`Pairing URI requires exactly one ${name} parameter`);
	return requireValue(values[0], name);
}

function writeLine(write: (text: string) => void, text: string): void {
	write(`${text}\n`);
}

function writeDevice(
	write: (text: string) => void,
	device: Extract<DaemonRpcResult, { op: "pair-claim" }>["device"],
): void {
	writeLine(write, `Device: ${device.name} (${device.id})`);
	writeLine(write, `Capabilities: ${device.capabilities.join(", ")}`);
}

function assertOperation<T extends DaemonRpcResult["op"]>(
	result: DaemonRpcResult,
	op: T,
): Extract<DaemonRpcResult, { op: T }> {
	if (result.op !== op) throw new Error(`Unexpected pairing response for ${op}`);
	return result as Extract<DaemonRpcResult, { op: T }>;
}

async function confirmPending(pending: PairingPendingMetadata, action: "approve" | "deny"): Promise<boolean> {
	const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		const question = prompt.render(pairConfirmationPrompt, {
			action: action === "approve" ? "Approve" : "Deny",
			name: pending.name,
			capabilities: pending.capabilities.join(", "),
		});
		const answer = await terminal.question(question);
		return answer.trim().toLowerCase() === "yes";
	} finally {
		terminal.close();
	}
}

function pairingCapabilities(capabilities: readonly string[] | undefined): DaemonCapability[] {
	return parseDaemonCapabilities(capabilities ?? ["observe"], "pairing capabilities");
}

function pairingTtl(ttlMs: number | undefined): number | undefined {
	if (ttlMs === undefined) return undefined;
	if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_PAIRING_TTL_MS) {
		throw new Error(`Pairing timeout must be an integer from 1 to ${MAX_PAIRING_TTL_MS}`);
	}
	return ttlMs;
}

function needsForegroundConfirmation(action: PairAction): action is "approve" | "deny" {
	return action === "approve" || action === "deny";
}

/** Encode a shareable enrollment URI without ever including broker or device credentials. */
export function formatPairingUri(target: DaemonNativeRemoteTarget, code: string): string {
	const checkedTarget = parseDaemonNativeRemoteTarget(target);
	const uri = new URL("omp://pair");
	uri.searchParams.set("endpoint", endpointUrl(checkedTarget));
	if (checkedTarget.transport === "tls" && checkedTarget.fingerprint256 !== undefined) {
		uri.searchParams.set("fingerprint256", checkedTarget.fingerprint256);
	}
	uri.searchParams.set("code", requireValue(code, "code"));
	return uri.toString();
}

/** Decode only the endpoint metadata and one-time enrollment code from a pairing URI. */
export function parsePairingUri(value: string): ParsedPairingUri {
	let uri: URL;
	try {
		uri = new URL(value);
	} catch {
		throw new Error("Pairing URI is malformed");
	}
	if (
		uri.protocol !== "omp:" ||
		uri.hostname !== "pair" ||
		uri.port !== "" ||
		(uri.pathname !== "" && uri.pathname !== "/") ||
		uri.username ||
		uri.password ||
		uri.hash
	) {
		throw new Error("Pairing URI must identify the pair endpoint only");
	}
	for (const [name] of uri.searchParams) {
		if (name !== "endpoint" && name !== "fingerprint256" && name !== "code") {
			throw new Error("Pairing URI contains an unexpected parameter");
		}
	}
	const endpoint = exactParameter(uri, "endpoint");
	const code = exactParameter(uri, "code");
	const fingerprints = uri.searchParams.getAll("fingerprint256");
	if (fingerprints.length > 1) throw new Error("Pairing URI contains duplicate fingerprint metadata");
	return { code, target: parsedTarget(endpoint, fingerprints[0]) };
}

/** Run one pairing action while keeping credentials confined to direct enrollment responses. */
export async function runPairCommand(command: PairCommandArgs, deps: PairingCommandDependencies): Promise<void> {
	const write = deps.writeStdout ?? (text => process.stdout.write(text));
	const renderQr = deps.renderQr ?? (uri => renderQrHalfBlocks(QrCode.encodeText(uri)));

	if (needsForegroundConfirmation(command.action)) {
		const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY === true;
		const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY === true;
		if (!stdinIsTTY || !stdoutIsTTY)
			throw new Error("Pairing approval and denial require an interactive foreground TTY");
		const code = requireValue(command.code, "code");
		const preview = assertOperation(await deps.client.request({ op: "pair-preview", code }), "pair-preview");
		const confirmed = await (deps.confirm ?? ((pending, action) => confirmPending(pending, action)))(
			preview,
			command.action,
		);
		if (!confirmed) {
			writeLine(write, `Pairing ${command.action} cancelled.`);
			return;
		}
		const operation: DaemonOperation = { op: command.action === "approve" ? "pair-approve" : "pair-deny", code };
		const result = await deps.client.request(operation);
		assertOperation(result, operation.op);
		writeLine(write, `Pairing ${command.action === "approve" ? "approved" : "denied"}.`);
		return;
	}

	switch (command.action) {
		case "begin": {
			const name = requireValue(command.name, "device name");
			const endpoint = requireValue(command.endpoint, "endpoint");
			const target = parsedTarget(endpoint, command.fingerprint256);
			const result = assertOperation(
				await deps.client.request({
					op: "pair-begin",
					name,
					capabilities: pairingCapabilities(command.capabilities),
					ttlMs: pairingTtl(command.ttlMs),
				}),
				"pair-begin",
			);
			const uri = formatPairingUri(target, result.code);
			writeLine(write, `Pairing code: ${result.code}`);
			writeLine(write, `Pairing URI: ${uri}`);
			for (const line of renderQr(uri)) writeLine(write, line);
			return;
		}
		case "claim": {
			const parsed = parsePairingUri(requireValue(command.uri, "URI"));
			const result = assertOperation(
				await deps.client.request({ op: "pair-claim", code: parsed.code }),
				"pair-claim",
			);
			writeDevice(write, result.device);
			writeLine(write, `Device token: ${result.token}`);
			return;
		}
		case "list": {
			const result = assertOperation(await deps.client.request({ op: "pair-list" }), "pair-list");
			if (result.devices.length === 0) {
				writeLine(write, "No paired devices.");
				return;
			}
			for (const device of result.devices) writeDevice(write, device);
			return;
		}
		case "revoke": {
			const id = requireValue(command.id, "device id");
			assertOperation(await deps.client.request({ op: "pair-revoke", id }), "pair-revoke");
			writeLine(write, "Paired device revoked.");
			return;
		}
		case "rotate": {
			const id = requireValue(command.id, "device id");
			const result = assertOperation(await deps.client.request({ op: "pair-rotate", id }), "pair-rotate");
			writeDevice(write, result.device);
			writeLine(write, `Device token: ${result.token}`);
			return;
		}
	}
}
