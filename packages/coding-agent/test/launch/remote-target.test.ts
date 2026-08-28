import { describe, expect, it } from "bun:test";
import { parseDaemonNativeRemoteTarget, parseDaemonNativeServerOptions } from "../../src/launch/protocol";

describe("native daemon remote target parser", () => {
	it("accepts loopback raw TCP for local development", () => {
		expect(parseDaemonNativeRemoteTarget("tcp://127.0.0.1:43123")).toEqual({
			transport: "tcp",
			host: "127.0.0.1",
			port: 43123,
		});
		expect(parseDaemonNativeRemoteTarget("tcp://[::1]:43123")).toEqual({
			transport: "tcp",
			host: "::1",
			port: 43123,
		});
	});

	it("accepts TLS targets with IPv4 and IPv6 hosts", () => {
		expect(parseDaemonNativeRemoteTarget("tls://daemon.example.test:443")).toEqual({
			transport: "tls",
			host: "daemon.example.test",
			port: 443,
		});
		expect(parseDaemonNativeRemoteTarget("tls://[2001:db8::7]:8443")).toEqual({
			transport: "tls",
			host: "2001:db8::7",
			port: 8443,
		});
	});

	it("rejects malformed or out-of-range ports", () => {
		for (const value of [
			"tcp://127.0.0.1",
			"tcp://127.0.0.1:0",
			"tcp://127.0.0.1:65536",
			"tcp://127.0.0.1:1.5",
			"tcp://127.0.0.1:not-a-port",
			"tls://daemon.example.test:0",
			"tls://daemon.example.test:65536",
		]) {
			expect(() => parseDaemonNativeRemoteTarget(value)).toThrow();
		}
	});

	it("rejects non-loopback raw TCP targets", () => {
		for (const value of [
			"tcp://localhost:43123",
			"tcp://0.0.0.0:43123",
			"tcp://192.168.1.20:43123",
			"tcp://[::]:43123",
			"tcp://[2001:db8::7]:43123",
		]) {
			expect(() => parseDaemonNativeRemoteTarget(value)).toThrow(/loopback|127\.0\.0\.1|::1/i);
		}
	});

	it("rejects TLS listener options without explicit certificate and key files", () => {
		const target = { transport: "tls", host: "daemon.example.test", port: 443 } as const;
		expect(() => parseDaemonNativeServerOptions({ target })).toThrow(/cert|key/i);
		expect(() => parseDaemonNativeServerOptions({ target, certFile: "server.crt" })).toThrow(/key/i);
		expect(() => parseDaemonNativeServerOptions({ target, keyFile: "server.key" })).toThrow(/cert/i);
	});
});
