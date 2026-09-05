import { describe, expect, it } from "bun:test";
import { OAuthCallbackFlow } from "../src/utils/oauth/callback-server";
import type { OAuthCredentials } from "../src/utils/oauth/types";

class SecurityProbeFlow extends OAuthCallbackFlow {
	lastRedirectUri?: string;
	lastState?: string;

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string }> {
		this.lastRedirectUri = redirectUri;
		this.lastState = state;
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

describe("OAuthCallbackFlow security and denial resilience", () => {
	it("ignores unauthenticated scanner requests and state mismatches without aborting login", async () => {
		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<string>();

		const flow = new SecurityProbeFlow(
			{
				onAuth: ({ url }) => resolveOnAuth(url),
				signal: AbortSignal.timeout(5_000),
			},
			0,
		);

		const loginPromise = flow.login();
		await onAuthCalled;

		if (!flow.lastRedirectUri || !flow.lastState) throw new Error("Expected auth info");
		const port = Number(new URL(flow.lastRedirectUri).port);

		// 1. Scanner sends garbage / invalid path
		const r1 = await fetch(`http://127.0.0.1:${port}/scan`);
		expect(r1.status).toBe(404);

		// 2. Scanner sends missing code
		const r2 = await fetch(`http://127.0.0.1:${port}/callback`);
		expect(r2.status).toBe(500);

		// 3. Scanner sends wrong state
		const r3 = await fetch(`http://127.0.0.1:${port}/callback?code=bad&state=wrong`);
		expect(r3.status).toBe(500);

		// 4. Scanner sends error without state
		const r4 = await fetch(`http://127.0.0.1:${port}/callback?error=unauthorized`);
		expect(r4.status).toBe(500);
		// 5. Genuine browser redirect arrives with valid code and expected state
		const r5 = await fetch(`http://127.0.0.1:${port}/callback?code=legit_code&state=${flow.lastState}`);
		expect(r5.status).toBe(200);

		const result = await loginPromise;
		expect(result.access).toBe("token-legit_code");
	});

	it("surfaces state-authenticated provider denials immediately without timing out", async () => {
		const { promise: onAuthCalled, resolve: resolveOnAuth } = Promise.withResolvers<string>();

		const flow = new SecurityProbeFlow(
			{
				onAuth: ({ url }) => resolveOnAuth(url),
				signal: AbortSignal.timeout(5_000),
			},
			0,
		);

		const loginPromise = flow.login();
		loginPromise.catch(() => {});
		await onAuthCalled;

		if (!flow.lastRedirectUri || !flow.lastState) throw new Error("Expected auth info");
		const port = Number(new URL(flow.lastRedirectUri).port);

		// User clicks Deny on provider consent screen: returns error + valid state nonce
		const denial = await fetch(
			`http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+declined&state=${flow.lastState}`,
		);
		expect(denial.status).toBe(500);

		await expect(loginPromise).rejects.toThrow(/Authorization failed: User declined/);
	});
});
