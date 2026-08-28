import { describe, expect, it } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { startDaemonBrokerFromEnvironment } from "../../src/launch/broker";
import { createDaemonBrokerClient, type DaemonBrokerClient } from "../../src/launch/client";
import { daemonBrokerEndpoint } from "../../src/launch/paths";
import {
	assertNativePathSafe,
	connectDaemonNativeRemote,
	createDaemonNativeServer,
	type DaemonNativeRemoteServer,
} from "../../src/launch/remote-transport";

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function privateTempDir(prefix: string): Promise<string> {
	const base = process.platform === "win32" ? os.homedir() : os.tmpdir();
	return fs.mkdtemp(path.join(base, prefix));
}

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

function openEndpoint(endpoint: string, timeoutMs = 500): Promise<net.Socket> {
	const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
	let socket: net.Socket;
	try {
		socket = net.createConnection({ path: endpoint });
	} catch (error) {
		reject(error instanceof Error ? error : new Error(String(error)));
		return promise;
	}
	let settled = false;
	const finish = (error?: Error): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		socket.off("connect", onConnect);
		socket.off("error", onError);
		socket.off("close", onClose);
		if (error) {
			socket.destroy();
			reject(error);
		} else {
			resolve(socket);
		}
	};
	const onConnect = (): void => finish();
	const onError = (error: Error): void => finish(error);
	const onClose = (): void => finish(new Error("endpoint closed before connection completed"));
	const timer = setTimeout(() => finish(new Error(`timed out connecting to endpoint ${endpoint}`)), timeoutMs);
	socket.once("connect", onConnect);
	socket.once("error", onError);
	socket.once("close", onClose);
	return promise;
}

async function connectEndpoint(endpoint: string): Promise<net.Socket> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < 240; attempt++) {
		try {
			return await openEndpoint(endpoint);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			await Bun.sleep(25);
		}
	}
	throw new Error(`endpoint did not start listening: ${lastError?.message ?? "unknown error"}`);
}

async function connectNativeEndpoint(target: Parameters<typeof connectDaemonNativeRemote>[0]): Promise<net.Socket> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt < 240; attempt++) {
		try {
			return await connectDaemonNativeRemote(target, { timeoutMs: 500 });
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			await Bun.sleep(25);
		}
	}
	throw new Error(`native endpoint did not start listening: ${lastError?.message ?? "unknown error"}`);
}

function openRawNativeEndpoint(target: { host: string; port: number }): Promise<net.Socket> {
	const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
	let socket: net.Socket;
	try {
		socket = net.createConnection({ host: target.host, port: target.port });
	} catch (error) {
		reject(error instanceof Error ? error : new Error(String(error)));
		return promise;
	}
	let settled = false;
	const finish = (error?: Error): void => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		socket.off("connect", onConnect);
		socket.off("error", onError);
		socket.off("close", onClose);
		if (error) {
			socket.destroy();
			reject(error);
		} else {
			resolve(socket);
		}
	};
	const onConnect = (): void => finish();
	const onError = (error: Error): void => finish(error);
	const onClose = (): void => finish(new Error("native raw endpoint closed before connection completed"));
	const timer = setTimeout(() => finish(new Error("timed out connecting to native raw endpoint")), 1_000);
	socket.once("connect", onConnect);
	socket.once("error", onError);
	socket.once("close", onClose);
	return promise;
}

async function sendPing(socket: net.Socket, token = TOKEN): Promise<unknown> {
	const { promise, resolve, reject } = Promise.withResolvers<unknown>();
	let buffer = "";
	const cleanup = (): void => {
		socket.off("data", onData);
		socket.off("error", onError);
		socket.off("close", onClose);
	};
	const onData = (chunk: string | Buffer): void => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		const newline = buffer.indexOf("\n");
		if (newline < 0) return;
		const line = buffer.slice(0, newline);
		cleanup();
		try {
			resolve(JSON.parse(line));
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	};
	const onError = (error: Error): void => {
		cleanup();
		reject(error);
	};
	const onClose = (): void => {
		cleanup();
		reject(new Error("endpoint closed before ping response"));
	};
	socket.setEncoding("utf8");
	socket.on("data", onData);
	socket.once("error", onError);
	socket.once("close", onClose);
	socket.write(`${JSON.stringify({ id: "ping", token, operation: { op: "ping" } })}\n`);
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
	const directory = await privateTempDir("omp-native-remote-");
	const certFile = path.join(directory, "server.crt");
	const keyFile = path.join(directory, "server.key");
	await fs.writeFile(certFile, fixture("CLAUDE_TRACE_DEBUG_CERT"), { mode: 0o644 });
	await fs.writeFile(keyFile, fixture("CLAUDE_TRACE_DEBUG_KEY"), { mode: 0o600 });
	return { directory, certFile, keyFile };
}

async function closeNativeServer(server: DaemonNativeRemoteServer | undefined): Promise<void> {
	await server?.close();
}
function grantUntrustedWriteAcl(directory: string): void {
	if (process.platform !== "win32") throw new Error("Windows ACL helper called on a non-Windows test host");
	const icacls = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "icacls.exe");
	childProcess.execFileSync(icacls, [directory, "/grant", "*S-1-1-0:(OI)(CI)(M)"], {
		windowsHide: true,
		stdio: "ignore",
	});
}

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
		let refused = false;
		try {
			const closedSocket = await connectDaemonNativeRemote(target, { timeoutMs: 100 });
			closedSocket.destroy();
		} catch {
			refused = true;
		}
		expect(refused).toBe(true);
	});
	it("accepts a normal user-profile private native path", async () => {
		const root = await fs.mkdtemp(path.join(os.homedir(), "omp-native-profile-"));
		const privateFile = path.join(root, "broker.token");
		try {
			await fs.writeFile(privateFile, TOKEN, { mode: 0o600 });
			await assertNativePathSafe(privateFile, { privateFinal: true, privateParent: true });
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	}, 15_000);

	it.skipIf(process.platform !== "win32")(
		"rejects Windows UNC native paths",
		async () => {
			const uncPath = "//server/share/broker.token";
			await expect(assertNativePathSafe(uncPath, { privateFinal: true, privateParent: true })).rejects.toThrow(
				/UNC|local|remote root/i,
			);
		},
		15_000,
	);

	it.skipIf(process.platform !== "win32")(
		"rejects NT namespace and non-fixed volume roots",
		async () => {
			const slash = String.fromCharCode(92);
			const namespacePaths = [
				`${slash}Device${slash}Mup${slash}server${slash}share${slash}broker.token`,
				`${slash}?${slash}UNC${slash}server${slash}share${slash}broker.token`,
				`${slash}.${slash}pipe${slash}broker`,
				"/server/share/broker.token",
			];
			for (const targetPath of namespacePaths) {
				await expect(assertNativePathSafe(targetPath, { privateFinal: true, privateParent: true })).rejects.toThrow(
					/local volume|namespace|UNC|remote root/i,
				);
			}
			const nonFixedVolumePath = `Z:${slash}omp-native-root${slash}broker.token`;
			await expect(
				assertNativePathSafe(nonFixedVolumePath, { privateFinal: true, privateParent: true }),
			).rejects.toThrow(/fixed local volume|local volume|network|remote volume/i);
		},
		15_000,
	);

	it("rejects a native private file under an untrusted writable parent", async () => {
		const root = await fs.mkdtemp(path.join(os.homedir(), "omp-native-unsafe-"));
		const parent = path.join(root, "parent");
		const privateFile = path.join(parent, "broker.token");
		try {
			await fs.mkdir(parent);
			await fs.writeFile(privateFile, TOKEN, { mode: 0o600 });
			if (process.platform === "win32") grantUntrustedWriteAcl(parent);
			else await fs.chmod(parent, 0o777);
			await expect(assertNativePathSafe(privateFile, { privateFinal: true, privateParent: true })).rejects.toThrow(
				/ACL|private|writable|trusted/i,
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	}, 15_000);

	it("rejects native TLS files through a reparse-point parent", async () => {
		const fixture = await writeTlsFixture();
		const root = await privateTempDir("omp-native-reparse-");
		const realDir = path.join(root, "real");
		const aliasDir = path.join(root, "alias");
		const certFile = path.join(aliasDir, "server.crt");
		const keyFile = path.join(aliasDir, "server.key");
		try {
			await fs.mkdir(realDir);
			await fs.symlink(realDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
			await fs.copyFile(fixture.certFile, path.join(realDir, "server.crt"));
			await fs.copyFile(fixture.keyFile, path.join(realDir, "server.key"));
			const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
			await expect(createDaemonNativeServer({ target, certFile, keyFile }, _socket => undefined)).rejects.toThrow(
				/reparse|symlink|safe|parent/i,
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	}, 15_000);

	it("serves TLS, discovers only a certificate fingerprint, and pins it after trust failure", async () => {
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
	}, 15_000);
	it("rejects a mismatched TLS certificate fingerprint", async () => {
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
	}, 15_000);

	it("accounts for pre-handshake TLS sockets and completes close", async () => {
		const fixture = await writeTlsFixture();
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		let raw: net.Socket | undefined;
		try {
			server = await createDaemonNativeServer(
				{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
				_socket => undefined,
			);
			raw = net.createConnection({ host: target.host, port: target.port });
			if (!raw) throw new Error("TLS test socket was not created");
			const { promise: connected, resolve, reject } = Promise.withResolvers<void>();
			raw.once("connect", resolve);
			raw.once("error", reject);
			await connected;
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
	}, 15_000);

	it("keeps a live TLS connection past the handshake deadline and cleans up", async () => {
		const fixture = await writeTlsFixture();
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		let client: net.Socket | undefined;
		try {
			const accepted = Promise.withResolvers<net.Socket>();
			server = await createDaemonNativeServer(
				{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
				socket => accepted.resolve(socket),
			);
			if (!server.fingerprint256) throw new Error("TLS server did not expose a certificate fingerprint");
			client = await connectDaemonNativeRemote(
				{ ...target, fingerprint256: server.fingerprint256 },
				{ timeoutMs: 2_000 },
			);
			const acceptedSocket = await accepted.promise;
			const { promise: deadline, resolve: resolveDeadline } = Promise.withResolvers<void>();
			setTimeout(resolveDeadline, 2_250);
			await deadline;
			expect(client.destroyed).toBe(false);
			expect(acceptedSocket.destroyed).toBe(false);
			client.destroy();
			expect(client.destroyed).toBe(true);
		} finally {
			client?.destroy();
			await closeNativeServer(server);
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	}, 15_000);

	it("bounds pending TLS handshakes separately from admission attempts", async () => {
		const fixture = await writeTlsFixture();
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		const stalled: net.Socket[] = [];
		try {
			server = await createDaemonNativeServer(
				{ target, certFile: fixture.certFile, keyFile: fixture.keyFile },
				_socket => undefined,
				{ limits: { globalMaxAttempts: 3, sourceMaxAttempts: 8, pendingHandshakeMax: 2 } },
			);
			stalled.push(await openRawNativeEndpoint(target));
			stalled.push(await openRawNativeEndpoint(target));
			stalled.push(await openRawNativeEndpoint(target));
			await waitForClose(stalled[2]);
			for (const socket of stalled.slice(0, 2)) {
				socket.destroy();
				await waitForClose(socket);
			}
			if (!server.fingerprint256) throw new Error("TLS server did not expose a certificate fingerprint");
			const socket = await connectDaemonNativeRemote(
				{ ...target, fingerprint256: server.fingerprint256 },
				{ timeoutMs: 1_000 },
			);
			socket.destroy();
			await waitForClose(socket);
		} finally {
			for (const socket of stalled) socket.destroy();
			await closeNativeServer(server);
			await fs.rm(fixture.directory, { recursive: true, force: true });
		}
	}, 15_000);

	it("aborts an in-flight native TLS connect 50ms after a handshake stall", async () => {
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		const accepted = Promise.withResolvers<void>();
		let stalledSocket: net.Socket | undefined;
		const stalledServer = net.createServer(socket => {
			stalledSocket = socket;
			accepted.resolve();
		});
		const { promise: listening, resolve: resolveListening, reject: rejectListening } = Promise.withResolvers<void>();
		stalledServer.once("error", rejectListening);
		stalledServer.listen({ host: target.host, port: target.port }, resolveListening);
		await listening;
		const projectDir = await privateTempDir("omp-native-tls-stall-project-");
		let client: DaemonBrokerClient | undefined;
		try {
			client = await createDaemonBrokerClient(projectDir, { target, token: TOKEN, connectTimeoutMs: 10_000 });
			const connecting = client.request({ op: "ping" }).then(
				() => ({ status: "resolved" as const }),
				error => ({
					status: "rejected" as const,
					error: error instanceof Error ? error : new Error(String(error)),
				}),
			);
			const { promise: acceptedOrTimedOut, resolve: resolveAcceptedOrTimedOut } = Promise.withResolvers<boolean>();
			const acceptTimer = setTimeout(() => resolveAcceptedOrTimedOut(false), 1_000);
			accepted.promise.then(() => resolveAcceptedOrTimedOut(true));
			expect(await acceptedOrTimedOut).toBe(true);
			clearTimeout(acceptTimer);
			await Bun.sleep(50);
			const closedAt = Date.now();
			client.close();
			const { promise: connectOutcomeTimeout, resolve: resolveConnectOutcomeTimeout } = Promise.withResolvers<{
				status: "timeout";
			}>();
			const connectTimer = setTimeout(() => resolveConnectOutcomeTimeout({ status: "timeout" }), 500);
			const outcome = await Promise.race([connecting, connectOutcomeTimeout]);
			clearTimeout(connectTimer);
			expect(outcome.status).toBe("rejected");
			if (outcome.status === "rejected") expect(outcome.error.message).toMatch(/abort|closed/i);
			expect(Date.now() - closedAt).toBeLessThan(500);
		} finally {
			client?.close();
			stalledSocket?.destroy();
			if (stalledServer.listening) {
				const { promise: closed, resolve: resolveClosed, reject: rejectClosed } = Promise.withResolvers<void>();
				stalledServer.close(error => (error ? rejectClosed(error) : resolveClosed()));
				await closed;
			}
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	}, 15_000);

	it("aborts a stalled native TLS request when its caller signal fires", async () => {
		const target = { transport: "tls" as const, host: "127.0.0.1", port: await freePort() };
		const accepted = Promise.withResolvers<void>();
		let stalledSocket: net.Socket | undefined;
		const stalledServer = net.createServer(socket => {
			stalledSocket = socket;
			accepted.resolve();
		});
		const { promise: listening, resolve: resolveListening, reject: rejectListening } = Promise.withResolvers<void>();
		stalledServer.once("error", rejectListening);
		stalledServer.listen({ host: target.host, port: target.port }, resolveListening);
		await listening;
		const projectDir = await privateTempDir("omp-native-tls-request-abort-project-");
		let client: DaemonBrokerClient | undefined;
		try {
			client = await createDaemonBrokerClient(projectDir, { target, token: TOKEN, connectTimeoutMs: 10_000 });
			const controller = new AbortController();
			const connecting = client.request({ op: "ping" }, controller.signal).then(
				() => ({ status: "resolved" as const }),
				error => ({
					status: "rejected" as const,
					error: error instanceof Error ? error : new Error(String(error)),
				}),
			);
			const unrelated = client.request({ op: "ping" }).then(
				() => ({ status: "resolved" as const }),
				error => ({
					status: "rejected" as const,
					error: error instanceof Error ? error : new Error(String(error)),
				}),
			);
			const { promise: acceptedOrTimedOut, resolve: resolveAcceptedOrTimedOut } = Promise.withResolvers<boolean>();
			const acceptTimer = setTimeout(() => resolveAcceptedOrTimedOut(false), 1_000);
			accepted.promise.then(() => resolveAcceptedOrTimedOut(true));
			expect(await acceptedOrTimedOut).toBe(true);
			clearTimeout(acceptTimer);
			await Bun.sleep(50);
			const abortedAt = Date.now();
			controller.abort();
			const { promise: abortOutcomeTimeout, resolve: resolveAbortOutcomeTimeout } = Promise.withResolvers<{
				status: "timeout";
			}>();
			const abortTimer = setTimeout(() => resolveAbortOutcomeTimeout({ status: "timeout" }), 500);
			const outcome = await Promise.race([connecting, abortOutcomeTimeout]);
			clearTimeout(abortTimer);
			expect(outcome.status).toBe("rejected");
			if (outcome.status === "rejected") expect(outcome.error.message).toMatch(/abort/i);
			expect(Date.now() - abortedAt).toBeLessThan(500);
			const { promise: unrelatedOutcomeTimeout, resolve: resolveUnrelatedOutcomeTimeout } = Promise.withResolvers<{
				status: "timeout";
			}>();
			const unrelatedTimer = setTimeout(() => resolveUnrelatedOutcomeTimeout({ status: "timeout" }), 200);
			const unrelatedOutcome = await Promise.race([unrelated, unrelatedOutcomeTimeout]);
			clearTimeout(unrelatedTimer);
			expect(unrelatedOutcome.status).toBe("timeout");
			client.close();
			const unrelatedAfterClose = await unrelated;
			expect(unrelatedAfterClose.status).toBe("rejected");
		} finally {
			client?.close();
			stalledSocket?.destroy();
			if (stalledServer.listening) {
				const { promise: closed, resolve: resolveClosed, reject: rejectClosed } = Promise.withResolvers<void>();
				stalledServer.close(error => (error ? rejectClosed(error) : resolveClosed()));
				await closed;
			}
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	}, 15_000);

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

	it("serves the local endpoint and native endpoint concurrently", async () => {
		const projectDir = await privateTempDir("omp-native-concurrent-project-");
		const runtimeRoot = await privateTempDir("omp-native-concurrent-runtime-");
		const runtimeDir = path.join(runtimeRoot, "runtime");
		await fs.mkdir(runtimeDir, { recursive: true });
		await fs.writeFile(path.join(runtimeDir, "broker.token"), TOKEN, { mode: 0o600 });
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		const endpoint = daemonBrokerEndpoint(projectDir, runtimeDir);
		const savedProject = process.env.OMP_DAEMON_PROJECT_DIR;
		const savedRuntime = process.env.OMP_DAEMON_RUNTIME_DIR;
		const savedGrace = process.env.OMP_DAEMON_IDLE_GRACE_MS;
		let brokerPromise: Promise<void> | undefined;
		let localSocket: net.Socket | undefined;
		let nativeSocket: net.Socket | undefined;
		try {
			process.env.OMP_DAEMON_PROJECT_DIR = projectDir;
			process.env.OMP_DAEMON_RUNTIME_DIR = runtimeDir;
			process.env.OMP_DAEMON_IDLE_GRACE_MS = "200";
			brokerPromise = startDaemonBrokerFromEnvironment({ nativeServer: { target } });
			localSocket = await connectEndpoint(endpoint);
			nativeSocket = await connectNativeEndpoint(target);
			const [localResponse, nativeResponse] = await Promise.all([sendPing(localSocket), sendPing(nativeSocket)]);
			const expected = expect.objectContaining({
				ok: true,
				result: expect.objectContaining({ op: "ping", projectDir }),
			});
			expect(localResponse).toEqual(expected);
			expect(nativeResponse).toEqual(expected);
		} finally {
			localSocket?.destroy();
			nativeSocket?.destroy();
			await brokerPromise?.catch(() => undefined);
			if (savedProject === undefined) delete process.env.OMP_DAEMON_PROJECT_DIR;
			else process.env.OMP_DAEMON_PROJECT_DIR = savedProject;
			if (savedRuntime === undefined) delete process.env.OMP_DAEMON_RUNTIME_DIR;
			else process.env.OMP_DAEMON_RUNTIME_DIR = savedRuntime;
			if (savedGrace === undefined) delete process.env.OMP_DAEMON_IDLE_GRACE_MS;
			else process.env.OMP_DAEMON_IDLE_GRACE_MS = savedGrace;
			await fs.rm(projectDir, { recursive: true, force: true });
			await fs.rm(runtimeRoot, { recursive: true, force: true });
		}
	}, 15_000);
	it("bounds client response and line buffering", async () => {
		const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-response-project-"));
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		let server: DaemonNativeRemoteServer | undefined;
		let client: DaemonBrokerClient | undefined;
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

	it("closes a native client at the authentication cap before idle shutdown", async () => {
		const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-auth-project-"));
		const runtimeRoot = await privateTempDir("omp-native-auth-runtime-");
		const runtimeDir = path.join(runtimeRoot, "runtime");
		await fs.mkdir(runtimeDir, { recursive: true });
		await fs.writeFile(path.join(runtimeDir, "broker.token"), TOKEN, { mode: 0o600 });
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		const savedProject = process.env.OMP_DAEMON_PROJECT_DIR;
		const savedRuntime = process.env.OMP_DAEMON_RUNTIME_DIR;
		const savedGrace = process.env.OMP_DAEMON_IDLE_GRACE_MS;
		let brokerPromise: Promise<void> | undefined;
		let attacker: net.Socket | undefined;
		let shutdownClient: DaemonBrokerClient | undefined;
		try {
			process.env.OMP_DAEMON_PROJECT_DIR = projectDir;
			process.env.OMP_DAEMON_RUNTIME_DIR = runtimeDir;
			process.env.OMP_DAEMON_IDLE_GRACE_MS = "30000";
			brokerPromise = startDaemonBrokerFromEnvironment({ nativeServer: { target } });
			attacker = await connectNativeEndpoint(target);
			attacker.resume();
			attacker.on("error", () => undefined);
			const badRequest = `${JSON.stringify({ id: "guess", token: "wrong", operation: { op: "ping" } })}\n`;
			const { promise: closeOutcome, resolve: resolveCloseOutcome } = Promise.withResolvers<"closed" | "timeout">();
			const closeTimer = setTimeout(() => resolveCloseOutcome("timeout"), 1_000);
			attacker.once("close", () => resolveCloseOutcome("closed"));
			// The third invalid attempt reaches the cap and must close before the 30s idle grace.
			attacker.write(badRequest.repeat(3));
			const outcome = await closeOutcome;
			clearTimeout(closeTimer);
			expect(outcome).toBe("closed");
			attacker = undefined;
			shutdownClient = await createDaemonBrokerClient(projectDir, {
				runtimeDir,
				target,
				token: TOKEN,
				connectTimeoutMs: 1_000,
			});
			await shutdownClient.request({ op: "shutdown" });
			shutdownClient.close();
			shutdownClient = undefined;
			await brokerPromise;
			brokerPromise = undefined;
		} finally {
			shutdownClient?.close();
			attacker?.destroy();
			await brokerPromise?.catch(() => undefined);
			if (savedProject === undefined) delete process.env.OMP_DAEMON_PROJECT_DIR;
			else process.env.OMP_DAEMON_PROJECT_DIR = savedProject;
			if (savedRuntime === undefined) delete process.env.OMP_DAEMON_RUNTIME_DIR;
			else process.env.OMP_DAEMON_RUNTIME_DIR = savedRuntime;
			if (savedGrace === undefined) delete process.env.OMP_DAEMON_IDLE_GRACE_MS;
			else process.env.OMP_DAEMON_IDLE_GRACE_MS = savedGrace;
			await fs.rm(runtimeRoot, { recursive: true, force: true });
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	}, 15_000);

	it("rejects malformed pre-existing native broker token files", async () => {
		const projectDir = await privateTempDir("omp-native-token-format-project-");
		const runtimeDir = path.join(projectDir, "runtime");
		await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
		await fs.writeFile(path.join(runtimeDir, "broker.token"), "weak-token", { mode: 0o600 });
		const target = { transport: "tcp" as const, host: "127.0.0.1" as const, port: await freePort() };
		try {
			await expect(
				createDaemonBrokerClient(projectDir, { runtimeDir, target, connectTimeoutMs: 100 }),
			).rejects.toThrow(/token|64|hexadecimal/i);
		} finally {
			await fs.rm(projectDir, { recursive: true, force: true });
		}
	});

	it("does not spawn or fall back to a local broker after a remote error", async () => {
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
});
