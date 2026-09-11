import type { Model } from "@oh-my-pi/pi-ai";
import { isFireworksFastModelId } from "@oh-my-pi/pi-catalog/fireworks-model-id";
import { KNOWN_HOSTS, type KnownHost, modelMatchesHost } from "@oh-my-pi/pi-catalog/hosts";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";

/**
 * EF2-R5 effort capability strategy, classified per endpoint/API/model —
 * never from model-id lineage alone.
 *
 * - `native-verified`: a catalog-recognized endpoint (provider id or URL
 *   marker) or a declared effort surface without a lineage claim may update
 *   effort natively on the wire.
 * - `prefix-sensitive`: routes that encode effort in the request identity
 *   (sibling model ids, `-fast` variants) — an effort change rewrites the
 *   cached prefix, so low-value proposals are declined and accepted
 *   escalations carry the full baseline→override→baseline cache risk.
 * - `unknown-conservative`: an unverified endpoint serving a nominal family
 *   alias (a custom "astra" provider claiming `glm-5.2`, a proxy claiming
 *   `claude-sonnet-4-5`) must not silently enter the native override path.
 */

export type EffortCapabilityStrategy = "native-verified" | "prefix-sensitive" | "unknown-conservative";

export interface EffortCapability {
	strategy: EffortCapabilityStrategy;
	/** Basis of the classification, safe for receipts and decline notices. */
	reason: string;
}

const KNOWN_HOST_IDS = Object.keys(KNOWN_HOSTS) as KnownHost[];

/**
 * Model-id tokens that claim a major reasoning lineage. Fired only when no
 * catalog host matches the endpoint: a claimed family on an unverified
 * endpoint is exactly the nominal-alias case capability must not trust.
 */
const FAMILY_CLAIM_PATTERNS: ReadonlyArray<readonly [family: string, pattern: RegExp]> = [
	["glm", /(^|[\s/.:-])glm-?\d/i],
	["claude", /claude-/i],
	["gpt", /(^|\/)(gpt-\d|o[1345]-)/i],
	["gemini", /gemini-/i],
	["deepseek", /deepseek/i],
	["kimi", /kimi/i],
	["qwen", /qwen/i],
	["minimax", /minimax/i],
	["grok", /grok/i],
	["mistral", /mistral/i],
	["llama", /llama/i],
];

function matchesAnyKnownHost(model: Model): boolean {
	return KNOWN_HOST_IDS.some(host => modelMatchesHost(model, host));
}

function claimedFamily(modelId: string): string | undefined {
	for (const [family, pattern] of FAMILY_CLAIM_PATTERNS) {
		if (pattern.test(modelId)) return family;
	}
	return undefined;
}

/**
 * Classify how the active endpoint/API/model supports thinking-effort
 * control. `undefined` models and models without a controllable surface are
 * conservative: there is nothing verified to control.
 */
export function resolveEffortCapabilityStrategy(model: Model | undefined): EffortCapability {
	if (!model || !model.reasoning || getSupportedEfforts(model).length === 0) {
		return { strategy: "unknown-conservative", reason: "the model exposes no controllable effort surface" };
	}
	if (model.provider === "devin") {
		return { strategy: "prefix-sensitive", reason: "devin cascade routes effort through sibling model ids" };
	}
	if (isFireworksFastModelId(model.id)) {
		return { strategy: "prefix-sensitive", reason: "fireworks fast variants select effort via the model id" };
	}
	if (!matchesAnyKnownHost(model)) {
		const family = claimedFamily(model.id);
		if (family) {
			return {
				strategy: "unknown-conservative",
				reason: `model id "${model.id}" claims the ${family} family but the endpoint is unverified (no catalog host match)`,
			};
		}
		return {
			strategy: "native-verified",
			reason: "the endpoint declares an effort surface and claims no lineage it is not verified for",
		};
	}
	return { strategy: "native-verified", reason: "catalog-recognized endpoint and api for this model" };
}
