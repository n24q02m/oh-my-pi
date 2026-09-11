import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { webHelp as commandHelp } from "../cli/command-help";
import { runWebCommand } from "../cli/web-cli";

export default class Web extends Command {
	static description = commandHelp.description;

	static flags = {
		host: Flags.string({ description: "Bind host (non-loopback hosts require --cert and --key)" }),
		port: Flags.integer({ char: "p", description: "Port to listen on (0 chooses a free port)", default: 0 }),
		origin: Flags.string({ description: "Allowed browser origin (repeatable)", multiple: true }),
		cert: Flags.string({ description: "TLS certificate file for non-loopback HTTPS" }),
		key: Flags.string({ description: "TLS private key file for non-loopback HTTPS" }),
		"static-dir": Flags.string({ description: "Built collab-web asset directory" }),
	};

	static examples = [
		"omp web",
		"omp web --port 8787 --origin https://operator.example",
		"omp web --host 0.0.0.0 --cert ~/.omp/tls/cert.pem --key ~/.omp/tls/key.pem",
	];

	async run(): Promise<void> {
		const { flags } = await this.parse(Web);
		await runWebCommand({
			host: flags.host,
			port: flags.port,
			origin: flags.origin,
			cert: flags.cert,
			key: flags.key,
			staticDir: flags["static-dir"],
		});
	}
}
