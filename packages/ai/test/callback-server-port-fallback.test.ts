import { afterEach, describe, expect, it } from "bun:test";
import { OAuthCallbackFlow } from "../src/utils/oauth/callback-server";
import type { OAuthCredentials } from "../src/utils/oauth/types";

class PortFallbackProbeFlow extends OAuthCallbackFlow {
	lastRedirectUri?: string;
	lastLaunchUrl?: string;

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
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

describe("OAuthCallbackFlow port fallback policy", () => {
	let occupyingServer: Bun.Server<unknown> | undefined;

	afterEach(() => {
		occupyingServer?.stop(true);
		occupyingServer = undefined;
	});

	it("fails fast with actionable error when allowPortFallback is false and port is busy", async () => {
		occupyingServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 54545,
			fetch: () => new Response("occupied"),
		});

		const flow = new PortFallbackProbeFlow(
			{
				onAuth: () => {},
				signal: AbortSignal.timeout(1_000),
			},
			{
				preferredPort: 54545,
				allowPortFallback: false,
			},
		);

		await expect(flow.login()).rejects.toThrow(
			/OAuth callback port 54545 is in use\. The OAuth provider validates redirect URIs against its registered callback/,
		);
		expect(flow.lastRedirectUri).toBeUndefined();
	});

	it("fails fast when explicit redirectUri is set and port is busy", async () => {
		occupyingServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 1455,
			fetch: () => new Response("occupied"),
		});

		const flow = new PortFallbackProbeFlow(
			{
				onAuth: () => {},
				signal: AbortSignal.timeout(1_000),
			},
			{
				preferredPort: 1455,
				callbackPath: "/auth/callback",
				redirectUri: "http://localhost:1455/auth/callback",
			},
		);

		await expect(flow.login()).rejects.toThrow(
			/OAuth callback port 1455 is in use, but oauth\.redirectUri \(http:\/\/localhost:1455\/auth\/callback\) requires this exact port/,
		);
		expect(flow.lastRedirectUri).toBeUndefined();
	});

	it("falls back to OS-assigned port when allowPortFallback is true (default)", async () => {
		occupyingServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 54545,
			fetch: () => new Response("occupied"),
		});

		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<string>();
		const controller = new AbortController();

		const flow = new PortFallbackProbeFlow(
			{
				onAuth: ({ url }) => resolveOnAuth(url),
				signal: controller.signal,
			},
			54545,
		);

		const loginPromise = flow.login();
		await onAuthCalled;

		expect(flow.lastRedirectUri).toBeDefined();
		expect(flow.lastRedirectUri).not.toBe("http://localhost:54545/callback");
		expect(flow.lastRedirectUri).toMatch(/^http:\/\/localhost:\d+\/callback$/);

		controller.abort("test done");
		await expect(loginPromise).rejects.toThrow();
	});
});
