import { describe, expect, it } from "bun:test";
import { RemoteApprovalRegistry } from "../../src/launch/remote-approval";

describe("remote approval registry", () => {
	it("binds a decision to one exact request and consumes it once", () => {
		let now = 1_000;
		const registry = new RemoteApprovalRegistry({ now: () => now, ttlMs: 1_000 });
		const request = registry.create({ daemonName: "web", operation: "stop", summary: "Confirm stop" });
		expect(registry.get(request.id)?.expiresAt).toBe(2_000);
		expect(registry.resolve(request.id, "approve")).toMatchObject({ decision: "approve", request });
		expect(() => registry.resolve(request.id, "deny")).toThrow("missing or expired");
		now = 3_000;
		expect(registry.list()).toEqual([]);
	});

	it("bounds summaries before they cross the browser boundary", () => {
		const registry = new RemoteApprovalRegistry();
		const request = registry.create({ daemonName: "daemon", operation: "stop", summary: `${"x".repeat(600)}\nsecret` });
		expect(request.summary.length).toBe(500);
		expect(request.summary).not.toContain("\n");
	});
});
