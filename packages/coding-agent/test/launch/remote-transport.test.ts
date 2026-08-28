import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
	connectDaemonNativeRemote,
	createDaemonNativeServer,
	type DaemonNativeRemoteServer,
} from "../../src/launch/remote-transport";

const TOKEN = "test-wire-token";

async function freePort(host = "127.0.0.1"): Promise<number> {
	const listener = net.createServer();
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	listener.once("error", reject);
	listener.listen({ host, port: 0 }, () => {
		const address = listener.address();
		if (!address || typeof address === "string") {
			reject(new Error("failed to reserve a TCP port"));
			return;
		}
		resolve(address.port);
	});
	const port = await promise;
	const { promise: closePromise, resolve: resolveClose, reject: rejectClose } = Promise.withResolvers<void>();
	listener.close(error => (error ? rejectClose(error) : resolveClose()));
	await closePromise;
	return port;
}

async function waitForClose(socket: net.Socket): Promise<void> {
	if (socket.destroyed) return;
	const { promise, resolve } = Promise.withResolvers<void>();
	socket.once("close", () => resolve());
	return promise;
}

async function writeTlsFixture(): Promise<{ directory: string; certFile: string; keyFile: string }> {
	const source = await fs.readFile(path.resolve(import.meta.dir, "../../src/cli/claude-trace-cli.ts"), "utf8");
	const markerEnd = String.fromCharCode(96);
	const fixture = (name: string): string => {
		const marker = `export const ${name} = `;
		const start = source.indexOf(marker);
		if (start < 0) throw new Error(`missing TLS test fixture ${name}`);
		const valueStart = start + marker.length + 1;
		const valueEnd = source.indexOf(markerEnd, valueStart);
		if (valueEnd < 0) throw new Error(`unterminated TLS test fixture ${name}`);
		return source.slice(valueStart, valueEnd);
	};
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-remote-"));
	const certFile = path.join(directory, "server.crt");
	const keyFile = path.join(directory, "server.key");
	await fs.writeFile(certFile, fixture("CLAUDE_TRACE_DEBUG_CERT"), { mode: 0o644 });
	await fs.writeFile(keyFile, fixture("CLAUDE_TRACE_DEBUG_KEY"), { mode: 0o600 });
	return { directory, certFile, keyFile };
}

async function closeNativeServer(server: DaemonNativeRemoteServer | undefined): Promise<void> {
	await server?.close();
}

const tlsTest = process.platform === "win32" ? it.skip : it;

describe("native remote transport sockets", () => {
	it("accepts and cleans up loopback TCP sockets", async () => {
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		try {
			server = await createDaemonNativeServer({ target }, socket => {
				socket.on("data", data => socket.end(data));
			});
			const socket = await connectDaemonNativeRemote(target, { timeoutMs: 1_000 });
			const response = Promise.withResolvers<Buffer>();
			socket.once("data", data => response.resolve(Buffer.from(data)));
			socket.write("tcp-ok");
			expect((await response.promise).toString()).toBe("tcp-ok");
			socket.destroy();
			await waitForClose(socket);
		} finally {
			await closeNativeServer(server);
		}
		await expect(connectDaemonNativeRemote(target, { timeoutMs: 100 })).rejects.toThrow();
	});

	tlsTest("serves TLS, discovers only a certificate fingerprint, and pins it after trust failure", async () => {
		const fixture = await writeTlsFixture();
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		try {
			server = await createDaemonNativeServer(
				{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
				_socket => undefined,
				{ limits: { globalMaxAttempts: 8, sourceMaxAttempts: 8, windowMs: 1_000 } },
			);
			if (!server.fingerprint256) throw new Error("TLS server did not expose a certificate fingerprint");
			expect(server.discovery.fingerprint256).toBe(server.fingerprint256);
			expect(JSON.stringify(server.discovery)).not.toContain(TOKEN);
			const pinnedTarget = { ...target, fingerprint256: server.fingerprint256 };
			const socket = await connectDaemonNativeRemote(pinnedTarget, { timeoutMs: 1_000 });
			socket.destroy();
			await waitForClose(socket);
		} finally {
			await closeNativeServer(server);
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	});

	tlsTest("rejects a mismatched TLS certificate fingerprint", async () => {
		const fixture = await writeTlsFixture();
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		try {
			server = await createDaemonNativeServer(
				{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
				_socket => undefined,
			);
			await expect(
				connectDaemonNativeRemote({ ...target, fingerprint256: "00".repeat(32) }, { timeoutMs: 1_000 }),
			).rejects.toThrow(/fingerprint/i);
		} finally {
			await closeNativeServer(server);
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	});

	it("accounts for pre-handshake TLS sockets and completes close", async () => {
		const fixture = await writeTlsFixture();
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		let raw: net.Socket | undefined;
		try {
			if (process.platform === "win32") {
				await expect(
					createDaemonNativeServer(
						{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
						() => undefined,
					),
				).rejects.toThrow(/safely.*Windows/i);
				return;
			}
			server = await createDaemonNativeServer(
				{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
				_socket => undefined,
			);
			raw = net.createConnection({ host: target.host, port: target.port });
			await new Promise<void>((resolve, reject) => {
				raw?.once("connect", resolve);
				raw?.once("error", reject);
			});
			await Promise.race([
				server.close(),
				Bun.sleep(1_000).then(() => {
					throw new Error("native TLS server close timed out with a pending handshake");
				}),
			]);
			await waitForClose(raw);
		} finally {
			raw?.destroy();
			await closeNativeServer(server);
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	});

	it("enforces the global admission bucket", async () => {
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		let accepted = 0;
		let server: DaemonNativeRemoteServer | undefined;
		try {
			server = await createDaemonNativeServer(
				{ target },
				_socket => {
					accepted += 1;
				},
				{ limits: { globalMaxAttempts: 1, sourceMaxAttempts: 8, windowMs: 1_000 } },
			);
			const first = await connectDaemonNativeRemote(target, { timeoutMs: 1_000 });
			first.destroy();
			await waitForClose(first);
			const second = await connectDaemonNativeRemote(target, { timeoutMs: 1_000 });
			await waitForClose(second);
			expect(accepted).toBe(1);
		} finally {
			await closeNativeServer(server);
		}
	});

	it("bounds source attempts and expires the bucket", async () => {
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		let accepted = 0;
		let server: DaemonNativeRemoteServer | undefined;
		try {
			server = await createDaemonNativeServer(
				{ target },
				_socket => {
					accepted += 1;
				},
				{ limits: { globalMaxAttempts: 8, sourceMaxAttempts: 1, windowMs: 100 } },
			);
			const first = await connectDaemonNativeRemote(target, { timeoutMs: 1_000 });
			first.destroy();
			await waitForClose(first);
			const second = await connectDaemonNativeRemote(target, { timeoutMs: 1_000 });
			await waitForClose(second);
			expect(accepted).toBe(1);
			// This deliberately exercises expiry against the real listener clock.
			await Bun.sleep(150);
			const third = await connectDaemonNativeRemote(target, { timeoutMs: 1_000 });
			third.destroy();
			await waitForClose(third);
			expect(accepted).toBe(2);
		} finally {
			await closeNativeServer(server);
		}
	});

	it("bounds client response and line buffering", async () => {
		const { createDaemonBrokerClient } = await import("../../src/launch/client");
		const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-response-project-"));
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		let client: Awaited<ReturnType<typeof createDaemonBrokerClient>> | undefined;
		try {
			server = await createDaemonNativeServer({ target }, socket => {
				socket.once("data", () => socket.write(Buffer.alloc(33 * 1024 * 1024, 0x78)));
			});
			client = await createDaemonBrokerClient(projectDir, {
				target,
				token: TOKEN,
				connectTimeoutMs: 1_000,
			});
			await expect(client.request({ op: "ping" })).rejects.toThrow(/response.*size/i);
		} finally {
			client?.close();
			await closeNativeServer(server);
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	it("bounds unauthenticated native broker guesses", async () => {
		const { startDaemonBrokerFromEnvironment } = await import("../../src/launch/broker");
		const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-auth-project-"));
		const runtimeDir = path.join(projectDir, "runtime");
		await fs.mkdir(runtimeDir, { recursive: true });
		await fs.writeFile(path.join(runtimeDir, "broker.token"), TOKEN, { mode: 0o600 });
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		const savedProject = process.env.OMP_DAEMON_PROJECT_DIR;
		const savedRuntime = process.env.OMP_DAEMON_RUNTIME_DIR;
		const savedGrace = process.env.OMP_DAEMON_IDLE_GRACE_MS;
		let brokerPromise: Promise<void> | undefined;
		let attacker: net.Socket | undefined;
		try {
			process.env.OMP_DAEMON_PROJECT_DIR = projectDir;
			process.env.OMP_DAEMON_RUNTIME_DIR = runtimeDir;
			process.env.OMP_DAEMON_IDLE_GRACE_MS = "200";
			brokerPromise = startDaemonBrokerFromEnvironment({ nativeServer: { target } });
			if (process.platform === "win32") {
				await expect(brokerPromise).rejects.toThrow(/safely.*Windows/i);
				brokerPromise = undefined;
				return;
			}
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					attacker = await new Promise<net.Socket>((resolve, reject) => {
						const socket = net.createConnection({ host: target.host, port: target.port });
						socket.once("connect", () => resolve(socket));
						socket.once("error", error => {
							socket.destroy();
							reject(error);
						});
					});
					break;
				} catch {
					await Bun.sleep(10);
				}
			}
			if (!attacker) throw new Error("native broker did not start listening");
			const badRequest = `${JSON.stringify({ id: "guess", token: "wrong", operation: { op: "ping" } })}\n`;
			attacker.write(badRequest.repeat(4));
			await waitForClose(attacker);
			attacker = undefined;
			await brokerPromise;
			brokerPromise = undefined;
		} finally {
			attacker?.destroy();
			await brokerPromise?.catch(() => undefined);
			if (savedProject === undefined) delete process.env.OMP_DAEMON_PROJECT_DIR;
			else process.env.OMP_DAEMON_PROJECT_DIR = savedProject;
			if (savedRuntime === undefined) delete process.env.OMP_DAEMON_RUNTIME_DIR;
			else process.env.OMP_DAEMON_RUNTIME_DIR = savedRuntime;
			if (savedGrace === undefined) delete process.env.OMP_DAEMON_IDLE_GRACE_MS;
			else process.env.OMP_DAEMON_IDLE_GRACE_MS = savedGrace;
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	it("does not spawn or fall back to a local broker after a remote error", async () => {
		const { createDaemonBrokerClient } = await import("../../src/launch/client");
		const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-remote-project-"));
		const runtimeDir = path.join(projectDir, "runtime");
		await fs.mkdir(runtimeDir, { recursive: true });
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		const client = await createDaemonBrokerClient(projectDir, {
			runtimeDir,
			target,
			token: TOKEN,
			connectTimeoutMs: 100,
		});
		try {
			await expect(client.request({ op: "ping" })).rejects.toThrow();
			expect(await fs.stat(path.join(runtimeDir, "broker.pid")).catch(() => undefined)).toBeUndefined();
		} finally {
			client.close();
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	it("keeps the existing local socket or named-pipe broker path working", async () => {
		const { smokeTestDaemonBroker } = await import("../../src/launch/client");
		await smokeTestDaemonBroker();
	});
});
