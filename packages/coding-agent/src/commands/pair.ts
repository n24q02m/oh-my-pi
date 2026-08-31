import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { pairHelp as commandHelp } from "../cli/command-help";
import { type PairAction, type PairCommandArgs, parsePairingUri, runPairCommand } from "../cli/pair-cli";
import { createDaemonBrokerClient } from "../launch/client";
import type { DaemonNativeRemoteTarget } from "../launch/protocol";

const PAIR_ACTIONS: PairAction[] = ["begin", "approve", "deny", "claim", "list", "revoke", "rotate"];

function parsePairAction(value: string | undefined): PairAction {
	if (value === undefined) return "list";
	if (value === "begin" || value === "approve" || value === "deny" || value === "claim") return value;
	if (value === "list" || value === "revoke" || value === "rotate") return value;
	throw new Error("Unknown pairing action");
}

function stringValues(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return [value];
	if (Array.isArray(value) && value.every(item => typeof item === "string")) return value;
	throw new Error("Pairing capability values must be strings");
}

function integerValue(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	throw new Error("Pairing timeout must be an integer");
}

function commandFromParsedArgs(
	action: PairAction,
	value: string | undefined,
	flags: { endpoint?: string; fingerprint?: string; capability?: unknown; ttlMs?: unknown },
): PairCommandArgs {
	switch (action) {
		case "begin":
			return {
				action,
				name: value,
				endpoint: flags.endpoint,
				fingerprint256: flags.fingerprint,
				capabilities: stringValues(flags.capability),
				ttlMs: integerValue(flags.ttlMs),
			};
		case "approve":
		case "deny":
			return { action, code: value };
		case "claim":
			return { action, uri: value };
		case "revoke":
		case "rotate":
			return { action, id: value };
		case "list":
			if (value !== undefined) throw new Error("omp pair list does not accept an argument");
			return { action };
	}
}

function claimConnection(command: PairCommandArgs): { target: DaemonNativeRemoteTarget; token: string } {
	if (command.action !== "claim" || command.uri === undefined) throw new Error("Pairing URI is required");
	const parsed = parsePairingUri(command.uri);
	return { target: parsed.target, token: parsed.code };
}

export default class Pair extends Command {
	static description = commandHelp.description;
	static args = {
		action: Args.string({ description: "Pairing action", required: false, options: PAIR_ACTIONS }),
		value: Args.string({ description: "Name, code, URI, or device ID", required: false }),
	};
	static flags = {
		endpoint: Flags.string({ description: "Advertised native endpoint (tcp:// or tls://) for begin" }),
		fingerprint: Flags.string({ description: "TLS SHA-256 fingerprint to embed in the pairing URI" }),
		capability: Flags.string({ description: "Requested capability for begin (repeatable)", multiple: true }),
		"ttl-ms": Flags.integer({ description: "Enrollment lifetime in milliseconds (maximum 900000)" }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Pair);
		const command = commandFromParsedArgs(parsePairAction(args.action), args.value, {
			endpoint: flags.endpoint,
			fingerprint: flags.fingerprint,
			capability: flags.capability,
			ttlMs: flags["ttl-ms"],
		});
		const client =
			command.action === "claim"
				? await createDaemonBrokerClient(process.cwd(), claimConnection(command))
				: await createDaemonBrokerClient(process.cwd());
		try {
			await runPairCommand(command, { client });
		} finally {
			client.close();
		}
	}
}
