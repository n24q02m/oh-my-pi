import { getProjectDir } from "@oh-my-pi/pi-utils";
import { startWebGateway, type WebGatewayOptions } from "../launch/web-gateway";

export interface WebCommandArgs {
	host?: string;
	port?: number;
	origin?: string[];
	cert?: string;
	key?: string;
	staticDir?: string;
}

/** Start the same-origin remote supervisor until the caller sends a termination signal. */
export async function runWebCommand(args: WebCommandArgs): Promise<void> {
	const options: WebGatewayOptions = {
		projectDir: getProjectDir(),
		hostname: args.host,
		port: args.port,
		originAllowlist: args.origin,
		certFile: args.cert,
		keyFile: args.key,
		staticDir: args.staticDir,
	};
	const gateway = await startWebGateway(options);
	console.log(`omp web supervisor listening on ${gateway.url}`);
	console.log(`  websocket ${gateway.websocketUrl}`);
	console.log(`  allowed origins ${gateway.originAllowlist.join(", ")}`);
	console.log("Waiting for a browser connection; pair a device with `omp pair` first.");

	const finished = Promise.withResolvers<void>();
	let stopping = false;
	const stop = (): void => {
		if (stopping) return;
		stopping = true;
		void gateway.close().then(
			() => finished.resolve(),
			error => finished.reject(error),
		);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		await finished.promise;
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
}
