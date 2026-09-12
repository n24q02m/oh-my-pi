import { afterEach, describe, expect, it, vi } from "bun:test";
import * as os from "node:os";
import { OAuthCallbackFlow } from "../src/utils/oauth/callback-server";
import type { OAuthCredentials } from "../src/utils/oauth/types";

class DualStackProbeFlow extends OAuthCallbackFlow {
	lastRedirectUri?: string;

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string }> {
		this.lastRedirectUri = redirectUri;
		return { url: `${redirectUri}?state=${state}` };
	}

	async exchangeToken(code: string, _state: string, _redirectUri: string): Promise<OAuthCredentials> {
		return {
			access: `token-${code}`,
			refresh: "refresh",
			expires: Date.now() + 60_000,
		};
	}
}

describe("OAuthCallbackFlow loopback address families", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("binds both IPv4 and IPv6 loopback interfaces when IPv6 is available", async () => {
		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<string>();
		const controller = new AbortController();

		const flow = new DualStackProbeFlow(
			{
				onAuth: ({ url }) => resolveOnAuth(url),
				signal: controller.signal,
			},
			0,
		);

		const loginPromise = flow.login();
		await onAuthCalled;

		if (!flow.lastRedirectUri) throw new Error("Expected redirectUri to be set");
		const port = Number(new URL(flow.lastRedirectUri).port);

		// Test IPv4 reachability
		const ipv4Response = await fetch(`http://127.0.0.1:${port}/unknown`);
		expect(ipv4Response.status).toBe(404);

		controller.abort("test done");
		await expect(loginPromise).rejects.toThrow();
	});

	it("serves IPv4 alone when IPv6 is disabled in network interfaces", async () => {
		// Mock os.networkInterfaces returning only IPv4
		vi.spyOn(os, "networkInterfaces").mockReturnValue({
			lo: [
				{
					address: "127.0.0.1",
					netmask: "255.0.0.0",
					family: "IPv4",
					mac: "00:00:00:00:00:00",
					internal: true,
					cidr: "127.0.0.1/8",
				},
			],
		});

		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<string>();
		const controller = new AbortController();

		const flow = new DualStackProbeFlow(
			{
				onAuth: ({ url }) => resolveOnAuth(url),
				signal: controller.signal,
			},
			0,
		);

		const loginPromise = flow.login();
		await onAuthCalled;

		if (!flow.lastRedirectUri) throw new Error("Expected redirectUri to be set");
		const port = Number(new URL(flow.lastRedirectUri).port);

		const res = await fetch(`http://127.0.0.1:${port}/unknown`);
		expect(res.status).toBe(404);

		controller.abort("test done");
		await expect(loginPromise).rejects.toThrow();
	});
});
