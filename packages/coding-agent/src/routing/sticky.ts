// src/routing/sticky.ts
//
// Sticky-tier hold: the cache-aware gate in front of the routing judge.
//
// The one idea: a per-turn tier switch cold-prefills the target model exactly
// when the source model's prefix cache is warmest (omp#12763). So once routing
// resolves a tier, HOLD it for the session segment — re-entering routing only
// at session start, after a compaction boundary (history rewritten; every
// cached prefix is cold by definition), or after an idle gap longer than the
// tier's prefix-cache TTL.
//
// Honest two-cache reality: prefix-cache lifetimes differ per provider
// (Anthropic ~5 min sliding, OpenAI varies by tier and load), so the TTL lives
// in the per-tier `jevRouting.tiers` config (`ttlMinutes`), with
// `jevRouting.sticky.defaultTtlMinutes` as the fallback for tiers that omit
// it. This is deliberately per-tier config, never one hard-coded number.
//
// Failure modes stay conservative:
//   - No cache-warmth signal (provider doesn't report cached-token counts, or
//     no turn ran on the held model yet) -> today's behavior: re-route fresh.
//     A hold must never ride a cache we cannot see.
//   - TTL expired while the prefix is STILL warm and the context is large
//     -> the judge may only route UP; it never trades a warm prefix for a
//     cheaper cold one.
//
// All state is per-session (ModelControls instance fields), never
// process-global; a new session starts unheld.

import type { Model, Usage } from "@oh-my-pi/pi-ai";
import type { Settings } from "../config/settings";
import {
	cfgJevRoutingStickyDefaultTtlMinutes,
	cfgJevRoutingStickyEnabled,
	cfgJevRoutingStickyEscapeThreshold,
	cfgJevRoutingStickyEscapeWindowTurns,
} from "./settings";

/** `jevRouting.sticky.*` — the sticky-hold configuration. */
export interface StickyConfig {
	enabled: boolean;
	/** Idle-gap TTL in minutes for tiers that do not declare their own `ttlMinutes`. */
	defaultTtlMinutes: number;
	/** Escalations within the window that force a fresh route. */
	escapeThreshold: number;
	/** Window (user turns) the escape threshold counts in. */
	escapeWindowTurns: number;
}

/** Fraction of the last turn's prompt tokens that must be cache reads for the prefix to count as warm. */
export const STICKY_WARM_CACHE_RATIO = 0.8;
/** Context size, as a fraction of the top tier's window, above which a cold prefill is expensive enough to guard. */
export const STICKY_LARGE_CONTEXT_RATIO = 0.4;

/** A routing decision held for the current session segment. */
export interface StickyHold {
	/** Tier id the segment is pinned to. */
	tierId: string;
	/** Compaction epoch at resolution; a different epoch ends the segment. */
	compactionEpoch: number;
	/** Epoch ms of the last turn served under this hold — the idle-gap clock. */
	lastTurnAtMs: number;
}

/** Cache-warmth of the held tier's prefix, judged from the last turn's usage. */
export interface WarmthSignal {
	/** False when no cached-token counts exist (provider never reports them, or no turn ran on this model yet). */
	available: boolean;
	/** True when the last turn's prompt was mostly served from cache. */
	warm: boolean;
}

/** `jevRouting.sticky.*` from the live settings. */
export function resolveStickyConfig(settings: Settings): StickyConfig {
	return {
		enabled: cfgJevRoutingStickyEnabled.get(settings),
		defaultTtlMinutes: cfgJevRoutingStickyDefaultTtlMinutes.get(settings),
		escapeThreshold: cfgJevRoutingStickyEscapeThreshold.get(settings),
		escapeWindowTurns: cfgJevRoutingStickyEscapeWindowTurns.get(settings),
	};
}

/**
 * Per-tier cache TTL in ms: the tier's own `ttlMinutes` wins over the sticky
 * default. The pool is cross-provider and cache lifetimes differ per provider,
 * so this is per-tier config, never one hard-coded number.
 */
export function tierTtlMs(tier: { ttlMinutes?: number }, config: StickyConfig): number {
	const minutes = tier.ttlMinutes !== undefined && tier.ttlMinutes > 0 ? tier.ttlMinutes : config.defaultTtlMinutes;
	return minutes * 60_000;
}

const WARMTH_UNAVAILABLE: WarmthSignal = { available: false, warm: false };

/**
 * Warmth of the prefix on `current`, judged from the last assistant turn's
 * usage. Usage from another model says nothing about this one's cache, and a
 * model reporting no cache activity at all leaves the signal missing —
 * callers fall back to re-routing fresh (today's behavior), never to a hold.
 */
export function lastTurnWarmth(
	last: { provider: string; model: string; usage: Usage } | undefined,
	current: Model | undefined,
): WarmthSignal {
	if (!last || !current) return WARMTH_UNAVAILABLE;
	if (last.provider !== current.provider || last.model !== current.id) return WARMTH_UNAVAILABLE;
	if (last.usage.cacheRead + last.usage.cacheWrite <= 0) return WARMTH_UNAVAILABLE;
	const promptTokens = last.usage.cacheRead + last.usage.input;
	return {
		available: true,
		warm: promptTokens > 0 && last.usage.cacheRead / promptTokens >= STICKY_WARM_CACHE_RATIO,
	};
}

/** Context large enough that a cold prefill matters: > {@link STICKY_LARGE_CONTEXT_RATIO} of the top tier's window. */
export function isLargeContext(
	contextTokens: number | null | undefined,
	topContextWindow: number | null | undefined,
): boolean {
	return (
		contextTokens != null &&
		topContextWindow != null &&
		topContextWindow > 0 &&
		contextTokens > topContextWindow * STICKY_LARGE_CONTEXT_RATIO
	);
}

export type StickyGate =
	| { action: "hold" }
	| {
			action: "reroute";
			/** When true the judge may not leave the held tier for a weaker one. */
			routeUpOnly: boolean;
	  };

export interface StickyGateContext {
	/** Current compaction epoch from the session stats tracker. */
	epoch: number;
	/** Now, epoch ms. */
	nowMs: number;
	/** Idle-gap TTL for the held tier, ms ({@link tierTtlMs}). */
	ttlMs: number;
	/** Warmth of the held tier's prefix ({@link lastTurnWarmth}). */
	warmth: WarmthSignal;
	/** True when the live context is large ({@link isLargeContext}). */
	largeContext: boolean;
}

/**
 * The per-turn sticky decision, taken BEFORE any judge call:
 *
 * - No hold, or a compaction since the hold was armed: re-route fresh. Nothing
 *   warm survives either event, so there is no prefix to protect.
 * - Within the TTL: hold (skip the judge) only while the cache is demonstrably
 *   still warm. A missing or cold signal resolves fresh — the conservative
 *   default is today's behavior.
 * - TTL expired: re-route. When the prefix is STILL warm (the provider's real
 *   cache outlives our TTL) and the context is large, the re-route is
 *   route-up-only: the judge may escalate, but never abandons a warm prefix
 *   for a cheaper cold one.
 */
export function stickyGate(hold: StickyHold | undefined, ctx: StickyGateContext): StickyGate {
	if (!hold) return { action: "reroute", routeUpOnly: false };
	if (hold.compactionEpoch !== ctx.epoch) return { action: "reroute", routeUpOnly: false };
	if (ctx.nowMs - hold.lastTurnAtMs <= ctx.ttlMs) {
		if (ctx.warmth.available && ctx.warmth.warm) return { action: "hold" };
		return { action: "reroute", routeUpOnly: false };
	}
	return { action: "reroute", routeUpOnly: ctx.warmth.available && ctx.warmth.warm && ctx.largeContext };
}

/**
 * True when `escalationTurns` (user-turn indices, ascending) holds at least
 * `config.escapeThreshold` entries within the last `config.escapeWindowTurns`
 * turns: the segment pinned the wrong tier, so the caller ends it early — drop
 * the hold and re-route from scratch.
 */
export function escalationsForceReroute(
	escalationTurns: readonly number[],
	currentTurn: number,
	config: StickyConfig,
): boolean {
	let inWindow = 0;
	for (let i = escalationTurns.length - 1; i >= 0; i--) {
		if (currentTurn - escalationTurns[i] > config.escapeWindowTurns) break;
		inWindow++;
	}
	return inWindow >= config.escapeThreshold;
}
