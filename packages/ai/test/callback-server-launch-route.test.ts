import { describe, expect, it } from "bun:test";
import { OAuthCallbackFlow } from "../src/utils/oauth/callback-server";
import type { OAuthCredentials } from "../src/utils/oauth/types";

class LaunchRouteProbeFlow extends OAuthCallbackFlow {
	lastAuthInfo?: { url: string; launchUrl?: string };

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string }> {
		const url = `https://auth.example.com/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&long_param=${"a".repeat(300)}`;
		return { url };
	}

	async exchangeToken(code: string, _state: string, _redirectUri: string): Promise<OAuthCredentials> {
		return {
			access: `token-${code}`,
			refresh: "refresh",
			expires: Date.now() + 60_000,
		};
	}
}

describe("OAuthCallbackFlow /launch route", () => {
	it("hosts a /launch route that redirects 302 to the pending authorization URL", async () => {
		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<void>();
		let flow!: LaunchRouteProbeFlow;

		flow = new DualLaunchProbeFlow(
			{
				onAuth: info => {
					flow.lastAuthInfo = info;
					resolveOnAuth();
				},
				signal: AbortSignal.timeout(5_000),
			},
			0,
		);

		const loginPromise = flow.login();
		await onAuthCalled;

		expect(flow.lastAuthInfo).toBeDefined();
		expect(flow.lastAuthInfo?.launchUrl).toBeDefined();
		expect(flow.lastAuthInfo?.launchUrl).toMatch(/^http:\/\/localhost:\d+\/launch$/);

		const launchUrl = flow.lastAuthInfo?.launchUrl;
		if (!launchUrl) throw new Error("Expected launchUrl");

		// Fetch /launch with redirect manual
		const launchResponse = await fetch(launchUrl, { redirect: "manual" });
		expect(launchResponse.status).toBe(302);
		const authUrl = flow.lastAuthInfo?.url;
		if (!authUrl) throw new Error("Expected auth URL");
		expect(launchResponse.headers.get("Location")).toBe(authUrl);

		// Complete login
		const redirectUri = new URL(launchUrl);
		redirectUri.pathname = "/callback";
		const state = new URL(flow.lastAuthInfo?.url ?? "").searchParams.get("state");
		const callbackResponse = await fetch(`${redirectUri.toString()}?code=xyz&state=${state}`);
		expect(callbackResponse.status).toBe(200);

		const result = await loginPromise;
		expect(result.access).toBe("token-xyz");
	});
});

class DualLaunchProbeFlow extends LaunchRouteProbeFlow {}
