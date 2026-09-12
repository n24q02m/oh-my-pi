import { afterEach, describe, expect, it } from "bun:test";
import { MCPOAuthFlow } from "../src/mcp/oauth-flow";

describe("MCPOAuthFlow listener ownership and port fallback", () => {
	let occupyingServer: Bun.Server<unknown> | undefined;

	afterEach(() => {
		occupyingServer?.stop(true);
		occupyingServer = undefined;
	});

	it("fails fast when static clientId is provided and preferred callback port is in use", async () => {
		occupyingServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 13000,
			fetch: () => new Response("busy"),
		});

		const flow = new MCPOAuthFlow(
			{
				authorizationUrl: "https://auth.example.com/oauth/authorize",
				tokenUrl: "https://auth.example.com/oauth/token",
				clientId: "static-client-123",
				callbackPort: 13000,
			},
			{
				onAuth: () => {},
				signal: AbortSignal.timeout(1_000),
			},
		);

		await expect(flow.login()).rejects.toThrow(/OAuth callback port 13000 is in use/);
	});

	it("fails fast when explicit redirectUri is configured and preferred port is in use", async () => {
		occupyingServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 13000,
			fetch: () => new Response("busy"),
		});

		const flow = new MCPOAuthFlow(
			{
				authorizationUrl: "https://auth.example.com/oauth/authorize",
				tokenUrl: "https://auth.example.com/oauth/token",
				redirectUri: "http://localhost:13000/callback",
			},
			{
				onAuth: () => {},
				signal: AbortSignal.timeout(1_000),
			},
		);

		await expect(flow.login()).rejects.toThrow(/OAuth callback port 13000 is in use, but oauth\.redirectUri/);
	});

	it("allows port fallback for dynamic client registration when no static clientId is configured", async () => {
		occupyingServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 13000,
			fetch: () => new Response("busy"),
		});

		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<string>();
		const controller = new AbortController();

		const flow = new MCPOAuthFlow(
			{
				authorizationUrl: "https://auth.example.com/oauth/authorize",
				tokenUrl: "https://auth.example.com/oauth/token",
				callbackPort: 13000,
			},
			{
				onAuth: ({ url }) => resolveOnAuth(url),
				signal: controller.signal,
			},
		);

		const loginPromise = flow.login();
		const authUrl = await onAuthCalled;

		expect(authUrl).toBeDefined();
		const redirectUriParam = new URL(authUrl).searchParams.get("redirect_uri");
		expect(redirectUriParam).toBeDefined();
		expect(redirectUriParam).toMatch(/^http:\/\/localhost:\d+\/callback$/);
		expect(redirectUriParam).not.toBe("http://localhost:13000/callback");

		controller.abort("test done");
		await expect(loginPromise).rejects.toThrow();
	});
});
