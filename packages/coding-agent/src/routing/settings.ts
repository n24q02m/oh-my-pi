/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";

// Sticky-hold defaults. These live here (not in `routing/sticky.ts`) because the
// registered handles below need them at module init; `sticky.ts` imports the
// handles, so the dependency stays one-directional.
/** Fallback idle gap (minutes) after which a held tier is re-probed; tiers override with their own `ttlMinutes`. */
export const DEFAULT_STICKY_TTL_MINUTES = 10;
/** Escalations within the window that end the segment early (the hold pinned the wrong tier). */
export const DEFAULT_STICKY_ESCAPE_THRESHOLD = 2;
/** Rolling window (user turns) the escape hatch counts escalations in. */
export const DEFAULT_STICKY_ESCAPE_WINDOW_TURNS = 4;

function validatePositiveMinutes(raw: unknown): void {
	// Unset (undefined/null on load, env-less, no configured layer) is valid —
	// the default applies. Only a concrete configured value must be positive.
	if (raw === undefined || raw === null) return;
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
		throw new Error(`Expected a positive number of minutes, got ${JSON.stringify(raw)}`);
	}
}

function validatePositiveCount(raw: unknown): void {
	if (raw === undefined || raw === null) return;
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
		throw new Error(`Expected an integer >= 1, got ${JSON.stringify(raw)}`);
	}
}

// Jev Model Routing steers each turn to a capability tier via TypeSafe System One judgments.
// Default OFF: when disabled or unconfigured the session model is used unchanged. The design is
// fail-open = fail expensive — any judge error, timeout, or low confidence keeps the top tier.
export const cfgJevRoutingEnabled = register({
	id: "jevRouting.enabled",
	type: "boolean",
	default: false,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Jev Model Routing",
		description:
			"Route each turn to a capability tier via TypeSafe System One judgments. Default OFF — when off or unconfigured the session model is used unchanged. Fail-open = fail expensive: any judge error, timeout, or low confidence keeps the top tier.",
	},
});

export const cfgJevRoutingTiers = register({
	id: "jevRouting.tiers",
	type: "array",
	default: [],
	ui: {
		tab: "model",
		group: "Routing",
		label: "Routing Tiers",
		description:
			'Ordered cheapest → most capable. Each tier: {id, model: "provider/model", capability: free-text eligibility test}. Order is load-bearing — the last tier is the fail-safe default.',
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingMinConfidenceToDegrade = register({
	id: "jevRouting.minConfidenceToDegrade",
	type: "number",
	default: 0.85,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Degrade Confidence",
		description:
			"Minimum judge confidence to route DOWN to a cheaper tier. 0.85 suits mixed-capability pools; flat pools may use 0.55–0.65.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingMaxComplexityForDegrade = register({
	id: "jevRouting.maxComplexityForDegrade",
	type: "number",
	default: 0.5,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Degrade Complexity Ceiling",
		description: "Complexity score at or below which routing down is allowed.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingMinComplexityConfidence = register({
	id: "jevRouting.minComplexityConfidence",
	type: "number",
	default: 0.5,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Complexity Confidence Floor",
		description: "Below this the complexity score is untrusted and the task is treated as hard.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingAllowVerify = register({
	id: "jevRouting.allowVerify",
	type: "boolean",
	default: true,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Verify Routed Output",
		description:
			"Post-hoc adequacy check on down-routed turns; a confident 'inadequate' verdict escalates to the next tier.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingMinConfidenceToEscalate = register({
	id: "jevRouting.minConfidenceToEscalate",
	type: "number",
	default: 0.7,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Escalate Confidence",
		description: "Minimum verifier confidence before acting on an 'inadequate' verdict.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingMaxEscalationsPerTurn = register({
	id: "jevRouting.maxEscalationsPerTurn",
	type: "number",
	default: 1,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Max Escalations Per Turn",
		description: "Cap on tier escalations within one turn; budget spent = accept output.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingStickyEnabled = register({
	id: "jevRouting.sticky.enabled",
	type: "boolean",
	default: true,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Sticky Tier Hold",
		description:
			"Hold the routed tier across turns instead of re-judging every turn — a per-turn switch cold-prefills the target exactly when the current prefix cache is warmest. The hold ends at a compaction, an idle gap longer than the tier's cache TTL, or when escalations breach the escape window. Without a cache-warmth signal the gate falls back to re-routing fresh.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingStickyDefaultTtlMinutes = register({
	id: "jevRouting.sticky.defaultTtlMinutes",
	type: "number",
	default: DEFAULT_STICKY_TTL_MINUTES,
	validate: validatePositiveMinutes,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Sticky TTL (minutes)",
		description:
			"Idle gap after which a held tier is re-probed, for tiers without their own ttlMinutes. Prefix-cache lifetimes differ per provider (Anthropic ~5 min sliding, OpenAI varies by tier/load) — prefer per-tier ttlMinutes in jevRouting.tiers.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingStickyEscapeThreshold = register({
	id: "jevRouting.sticky.escapeThreshold",
	type: "number",
	default: DEFAULT_STICKY_ESCAPE_THRESHOLD,
	validate: validatePositiveCount,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Sticky Escape Threshold",
		description:
			"Escalations within the window that end the sticky segment early — the hold pinned the wrong tier, so the next turn re-routes fresh.",
		condition: "jevRoutingActive",
	},
});

export const cfgJevRoutingStickyEscapeWindowTurns = register({
	id: "jevRouting.sticky.escapeWindowTurns",
	type: "number",
	default: DEFAULT_STICKY_ESCAPE_WINDOW_TURNS,
	validate: validatePositiveCount,
	ui: {
		tab: "model",
		group: "Routing",
		label: "Sticky Escape Window (turns)",
		description: "Rolling window of user turns the escape threshold counts escalations in.",
		condition: "jevRoutingActive",
	},
});
