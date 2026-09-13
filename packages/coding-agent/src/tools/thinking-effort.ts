import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";

/**
 * EF2-R3 next-request thinking-effort override.
 *
 * A first-party HIDDEN tool the model calls to propose the thinking effort for
 * its NEXT main logical request. The proposal is temporary by contract: it is
 * consumed once at actual dispatch, expires afterwards, never disables the
 * configured `auto` policy, and can never change the effort of the response
 * being generated when the call happens. Presence is gated to opt-in adaptive
 * mode (`providers.autoThinkingAdaptive`).
 *
 * The description and schema are STATIC for a capability epoch: they must not
 * interpolate the current effort, which changes per turn.
 */

/** Structural session surface the tool needs; `ToolSession` satisfies it. */
export interface ThinkingEffortSession {
	proposeThinkingEffort?(requested: string): { accepted: boolean; effort?: string; reason?: string } | undefined;
}

const EFFORT_LEVELS = '"minimal" | "low" | "medium" | "high" | "xhigh" | "max"';

const thinkingEffortSchema = type({
	effort: type(EFFORT_LEVELS).describe(
		"thinking effort for the NEXT main request; temporary — the session returns to its automatic baseline afterwards",
	),
	"+": "reject",
}).describe("propose the thinking effort for the next main request");

type ThinkingEffortParams = typeof thinkingEffortSchema.infer;

interface ThinkingEffortDetails {
	accepted: boolean;
	effort?: string;
}

/** Proposes a temporary next-request thinking effort; consumed at next dispatch. */
export class ThinkingEffortTool implements AgentTool<typeof thinkingEffortSchema, ThinkingEffortDetails> {
	readonly name = "thinking_effort";
	readonly approval = "read" as const;
	readonly label = "Thinking Effort";
	readonly summary = "Propose next-request thinking effort";
	readonly description =
		"Propose the thinking-effort level for your NEXT turn. The override applies to the next main request only, " +
		"then the session returns to its automatic baseline. Rejected when the user pinned a manual effort level or " +
		"when adaptive effort is off. It cannot change the effort of the response being generated right now.";
	readonly parameters = thinkingEffortSchema;
	readonly strict = true;
	readonly intent = "omit" as const;

	#session: ThinkingEffortSession;

	constructor(session: ThinkingEffortSession) {
		this.#session = session;
	}

	async execute(_toolCallId: string, params: ThinkingEffortParams): Promise<AgentToolResult<ThinkingEffortDetails>> {
		const outcome = this.#session.proposeThinkingEffort?.(params.effort);
		if (!outcome) {
			return {
				content: [{ type: "text", text: "Effort override unavailable in this session." }],
				details: { accepted: false },
			};
		}
		if (outcome.accepted) {
			const applied = outcome.effort ?? params.effort;
			return {
				content: [
					{
						type: "text",
						text: `Accepted: the next request will run at thinking effort "${applied}" (temporary; the session returns to its automatic baseline afterwards).`,
					},
				],
				details: { accepted: true, effort: applied },
			};
		}
		return {
			content: [{ type: "text", text: `Rejected: ${outcome.reason ?? "proposal not accepted"}.` }],
			details: { accepted: false },
		};
	}
}
