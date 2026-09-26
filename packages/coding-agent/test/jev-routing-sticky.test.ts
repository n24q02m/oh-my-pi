import { describe, expect, it } from "bun:test";
import type { Model, Usage } from "@oh-my-pi/pi-ai";
import { toJevTiers } from "../src/routing/availability";
import {
	escalationsForceReroute,
	isLargeContext,
	lastTurnWarmth,
	resolveStickyConfig,
	type StickyConfig,
	STICKY_LARGE_CONTEXT_RATIO,
	STICKY_WARM_CACHE_RATIO,
	stickyGate,
	tierTtlMs,
} from "../src/routing/sticky";
import {
	cfgJevRoutingStickyDefaultTtlMinutes,
	cfgJevRoutingStickyEnabled,
	cfgJevRoutingStickyEscapeThreshold,
	cfgJevRoutingStickyEscapeWindowTurns,
} from "../src/routing/settings";
import { Settings } from "../src/config/settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function usage(partial: Partial<Usage>): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...partial,
	};
}
const MODEL = { provider: "anthropic", id: "claude-x" } as unknown as Model;
const OTHER_MODEL = { provider: "openai", id: "gpt-y" } as unknown as Model;
const WARM = { available: true, warm: true } as const;
const COLD = { available: true, warm: false } as const;
const MISSING = { available: false, warm: false } as const;
const CONFIG: StickyConfig = {
	enabled: true,
	defaultTtlMinutes: 10,
	escapeThreshold: 2,
	escapeWindowTurns: 4,
};
const hold = (lastTurnAtMs: number, compactionEpoch = 0) => ({ tierId: "cheap", compactionEpoch, lastTurnAtMs });

// ---------------------------------------------------------------------------
// Sticky gate — hold across turns, resets, per-tier TTL, warmth guard
// ---------------------------------------------------------------------------
describe("stickyGate", () => {
	const t0 = 1_000_000;
	const withinTtl = { epoch: 0, nowMs: t0 + 60_000, ttlMs: 600_000, largeContext: false };

	it("holds within the TTL when the cache is warm (no judge call)", () => {
		expect(stickyGate(hold(t0), { ...withinTtl, warmth: WARM })).toEqual({ action: "hold" });
	});

	it("re-routes fresh on session start (no hold)", () => {
		expect(stickyGate(undefined, { ...withinTtl, warmth: WARM })).toEqual({ action: "reroute", routeUpOnly: false });
	});

	it("ends the segment at a compaction boundary even within the TTL", () => {
		// History was rewritten: every cached prefix is cold by definition.
		expect(stickyGate(hold(t0, 0), { ...withinTtl, epoch: 1, warmth: WARM })).toEqual({
			action: "reroute",
			routeUpOnly: false,
		});
	});

	it("re-routes when the warmth signal is missing (conservative default = today's behavior)", () => {
		expect(stickyGate(hold(t0), { ...withinTtl, warmth: MISSING })).toEqual({
			action: "reroute",
			routeUpOnly: false,
		});
	});

	it("re-routes when the cache went cold before the TTL", () => {
		expect(stickyGate(hold(t0), { ...withinTtl, warmth: COLD })).toEqual({ action: "reroute", routeUpOnly: false });
	});

	it("re-routes once the per-tier TTL expires, even when warm", () => {
		// Small context: a cold prefill is cheap, no guard needed.
		expect(
			stickyGate(hold(t0), { epoch: 0, nowMs: t0 + 600_001, ttlMs: 600_000, warmth: WARM, largeContext: false }),
		).toEqual({ action: "reroute", routeUpOnly: false });
	});

	it("restricts an expired re-route to route-up-only when warm on a large context", () => {
		expect(
			stickyGate(hold(t0), { epoch: 0, nowMs: t0 + 600_001, ttlMs: 600_000, warmth: WARM, largeContext: true }),
		).toEqual({ action: "reroute", routeUpOnly: true });
	});

	it("does not guard an expired re-route when the warmth signal is missing", () => {
		expect(
			stickyGate(hold(t0), { epoch: 0, nowMs: t0 + 600_001, ttlMs: 600_000, warmth: MISSING, largeContext: true }),
		).toEqual({ action: "reroute", routeUpOnly: false });
	});

	it("treats the exact TTL boundary as unexpired", () => {
		expect(
			stickyGate(hold(t0), { epoch: 0, nowMs: t0 + 600_000, ttlMs: 600_000, warmth: WARM, largeContext: false }),
		).toEqual({ action: "hold" });
	});
});

// ---------------------------------------------------------------------------
// Warmth — cached-token counts from the last assistant turn
// ---------------------------------------------------------------------------
describe("lastTurnWarmth", () => {
	const warmUsage = () => usage({ input: 200, cacheRead: 800, cacheWrite: 100 });

	it("is missing without a prior turn or model", () => {
		expect(lastTurnWarmth(undefined, MODEL)).toEqual(MISSING);
		expect(lastTurnWarmth({ provider: "anthropic", model: "claude-x", usage: warmUsage() }, undefined)).toEqual(
			MISSING,
		);
	});

	it("is missing when the last turn ran on another model", () => {
		expect(
			lastTurnWarmth({ provider: OTHER_MODEL.provider, model: OTHER_MODEL.id, usage: warmUsage() }, MODEL),
		).toEqual(MISSING);
	});

	it("is missing when the provider reports no cache activity at all", () => {
		const noSignal = usage({ input: 500 });
		expect(lastTurnWarmth({ provider: "anthropic", model: "claude-x", usage: noSignal }, MODEL)).toEqual(MISSING);
	});

	it("is warm at or above the cache-read ratio", () => {
		expect(lastTurnWarmth({ provider: "anthropic", model: "claude-x", usage: warmUsage() }, MODEL)).toEqual(WARM);
	});

	it("is available but cold below the cache-read ratio", () => {
		const mostlyFresh = usage({ input: 900, cacheRead: 100, cacheWrite: 50 });
		const signal = lastTurnWarmth({ provider: "anthropic", model: "claude-x", usage: mostlyFresh }, MODEL);
		expect(signal).toEqual(COLD);
		expect(signal.available).toBe(true);
	});

	it("treats a first-hit cache write as available but not warm", () => {
		const firstHit = usage({ input: 0, cacheRead: 0, cacheWrite: 500 });
		expect(lastTurnWarmth({ provider: "anthropic", model: "claude-x", usage: firstHit }, MODEL)).toEqual(COLD);
	});

	it("matches the documented ratio constant", () => {
		expect(STICKY_WARM_CACHE_RATIO).toBe(0.8);
	});
});

// ---------------------------------------------------------------------------
// Per-tier TTL — the pool is cross-provider, so TTL is per-tier config
// ---------------------------------------------------------------------------
describe("tierTtlMs", () => {
	it("prefers the tier's own ttlMinutes over the sticky default", () => {
		expect(tierTtlMs({ ttlMinutes: 5 }, CONFIG)).toBe(5 * 60_000);
		expect(tierTtlMs({ ttlMinutes: 30 }, CONFIG)).toBe(30 * 60_000);
	});

	it("falls back to the sticky default for tiers without one", () => {
		expect(tierTtlMs({}, CONFIG)).toBe(10 * 60_000);
	});

	it("treats a non-positive tier ttlMinutes as unset", () => {
		expect(tierTtlMs({ ttlMinutes: 0 }, CONFIG)).toBe(10 * 60_000);
		expect(tierTtlMs({ ttlMinutes: -3 }, CONFIG)).toBe(10 * 60_000);
	});
});

// ---------------------------------------------------------------------------
// Large context — the cold-prefill guard threshold
// ---------------------------------------------------------------------------
describe("isLargeContext", () => {
	it("crosses the guard above 40% of the top tier's window", () => {
		expect(STICKY_LARGE_CONTEXT_RATIO).toBe(0.4);
		expect(isLargeContext(401, 1000)).toBe(true);
		expect(isLargeContext(400, 1000)).toBe(false);
	});

	it("is false when either size is unknown", () => {
		expect(isLargeContext(undefined, 1000)).toBe(false);
		expect(isLargeContext(5000, undefined)).toBe(false);
		expect(isLargeContext(5000, 0)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Escape hatch — N escalations within M turns end the segment early
// ---------------------------------------------------------------------------
describe("escalationsForceReroute", () => {
	it("forces a re-route at the threshold within the window", () => {
		expect(escalationsForceReroute([1, 3], 4, CONFIG)).toBe(true);
	});

	it("stays held below the threshold", () => {
		expect(escalationsForceReroute([3], 4, CONFIG)).toBe(false);
	});

	it("ignores escalations older than the window", () => {
		// Both escalations are more than 4 turns back.
		expect(escalationsForceReroute([1, 2], 7, CONFIG)).toBe(false);
		// Only one is inside the window.
		expect(escalationsForceReroute([1, 6], 7, CONFIG)).toBe(false);
	});

	it("counts escalations at the window edge", () => {
		// 4 turns back == escapeWindowTurns; still inside.
		expect(escalationsForceReroute([0, 4], 4, CONFIG)).toBe(true);
	});

	it("never fires on an empty log", () => {
		expect(escalationsForceReroute([], 10, CONFIG)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Settings surface — defaults, validation, per-tier override precedence
// ---------------------------------------------------------------------------
describe("sticky settings surface", () => {
	it("exposes the documented defaults", () => {
		const settings = Settings.isolated();
		expect(cfgJevRoutingStickyEnabled.get(settings)).toBe(true);
		expect(cfgJevRoutingStickyDefaultTtlMinutes.get(settings)).toBe(10);
		expect(cfgJevRoutingStickyEscapeThreshold.get(settings)).toBe(2);
		expect(cfgJevRoutingStickyEscapeWindowTurns.get(settings)).toBe(4);
	});

	it("reads live values through resolveStickyConfig", () => {
		const settings = Settings.isolated();
		cfgJevRoutingStickyEnabled.set(settings, false);
		cfgJevRoutingStickyDefaultTtlMinutes.set(settings, 30);
		cfgJevRoutingStickyEscapeThreshold.set(settings, 3);
		cfgJevRoutingStickyEscapeWindowTurns.set(settings, 6);
		expect(resolveStickyConfig(settings)).toEqual({
			enabled: false,
			defaultTtlMinutes: 30,
			escapeThreshold: 3,
			escapeWindowTurns: 6,
		});
	});

	it("rejects invalid configured values", () => {
		const settings = Settings.isolated();
		expect(() => cfgJevRoutingStickyDefaultTtlMinutes.set(settings, 0)).toThrow();
		expect(() => cfgJevRoutingStickyDefaultTtlMinutes.set(settings, -5)).toThrow();
		expect(() => cfgJevRoutingStickyEscapeThreshold.set(settings, 0)).toThrow();
		expect(() => cfgJevRoutingStickyEscapeThreshold.set(settings, 1.5)).toThrow();
		expect(() => cfgJevRoutingStickyEscapeWindowTurns.set(settings, 0)).toThrow();
	});

	it("accepts valid configured values", () => {
		const settings = Settings.isolated();
		cfgJevRoutingStickyDefaultTtlMinutes.set(settings, 0.5);
		cfgJevRoutingStickyEscapeThreshold.set(settings, 1);
		cfgJevRoutingStickyEscapeWindowTurns.set(settings, 10);
		expect(resolveStickyConfig(settings).defaultTtlMinutes).toBe(0.5);
	});

	it("parses per-tier ttlMinutes and drops invalid entries", () => {
		const tiers = toJevTiers([
			{ id: "cheap", model: "a/m1", capability: "mechanical", ttlMinutes: 5 },
			{ id: "mid", model: "a/m2", capability: "judgment", ttlMinutes: -1 },
			{ id: "top", model: "a/m3", capability: "architecture" },
		]);
		expect(tiers.map(t => t.id)).toEqual(["cheap", "mid", "top"]);
		expect(tiers[0].ttlMinutes).toBe(5);
		expect(tiers[1].ttlMinutes).toBeUndefined();
		expect(tiers[2].ttlMinutes).toBeUndefined();
		// Precedence: the tier's own TTL wins; the others use the sticky default.
		const settings = Settings.isolated();
		expect(tierTtlMs(tiers[0], resolveStickyConfig(settings))).toBe(5 * 60_000);
		expect(tierTtlMs(tiers[2], resolveStickyConfig(settings))).toBe(10 * 60_000);
	});

	it("keeps a configured sticky default in sync with the tier fallback", () => {
		const settings = Settings.isolated();
		cfgJevRoutingStickyDefaultTtlMinutes.set(settings, 15);
		expect(tierTtlMs({}, resolveStickyConfig(settings))).toBe(15 * 60_000);
	});
});
