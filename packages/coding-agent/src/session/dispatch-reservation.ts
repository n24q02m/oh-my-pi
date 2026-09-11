import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { isUserInvokedSkillPrompt } from "./messages";
import { extractTextContent } from "../auto-thinking/task-context";

/**
 * EF2-R1 dispatch reservation mechanics.
 *
 * A queued steer/follow-up batch is classified by the shared dispatch seam
 * *before* it is dequeued, so the decision must be bound to the exact batch
 * that will actually be dispatched. This module snapshots the agent-core
 * queues by message identity, stamps each message with a monotonic revision,
 * and revalidates a reservation against live queue state, the session prompt
 * generation, and the selected model — so queue edits, cancels, concurrent
 * enqueues, aborts, replacement sessions and model switches all invalidate a
 * stale decision before it can apply.
 *
 * Target resolution mirrors `Agent.continue()`: when the steering queue is
 * non-empty the next request opens with the steering batch and follow-ups
 * stay queued; only when steering is empty does the follow-up batch open the
 * request.
 */

/** Minimal live queue view; `Agent` satisfies this structurally. */
export interface QueuedMessageSource {
	peekSteeringQueue(): readonly AgentMessage[];
	peekFollowUpQueue(): readonly AgentMessage[];
}

export interface QueuedMessageRef {
	readonly message: AgentMessage;
	/** Session-scoped monotonic revision, stamped on first observation. */
	readonly revision: number;
	readonly text: string;
}

export interface DispatchBatchSnapshot {
	readonly steering: readonly QueuedMessageRef[];
	readonly followUp: readonly QueuedMessageRef[];
}

export interface DispatchBatchReservation {
	/** Monotonic reservation id, unique per {@link DispatchReviser}-owning session. */
	readonly id: number;
	/** Session prompt generation captured at reserve time. */
	readonly generation: number;
	/** Resolved model identity (`provider/id`) captured at reserve time. */
	readonly modelKey: string;
	/** The messages the next request will actually open with, in order. */
	readonly target: readonly QueuedMessageRef[];
	/** Full queue snapshot at reserve time, for exact revalidation. */
	readonly snapshot: DispatchBatchSnapshot;
}

export interface ReservationNow {
	readonly generation: number;
	readonly modelKey: string;
}

/** Assigns stable monotonic revisions to queued message objects. */
export class DispatchReviser {
	#revisions = new WeakMap<AgentMessage, number>();
	#nextRevision = 1;
	#nextReservationId = 1;

	revisionOf(message: AgentMessage): number {
		let revision = this.#revisions.get(message);
		if (revision === undefined) {
			revision = this.#nextRevision++;
			this.#revisions.set(message, revision);
		}
		return revision;
	}

	nextReservationId(): number {
		return this.#nextReservationId++;
	}
}

function snapshotQueue(messages: readonly AgentMessage[], reviser: DispatchReviser): QueuedMessageRef[] {
	return messages.map(message => ({
		message,
		revision: reviser.revisionOf(message),
		text: extractTextContent(message),
	}));
}

/** Snapshot both queues by message identity with revision stamps. */
export function snapshotQueues(source: QueuedMessageSource, reviser: DispatchReviser): DispatchBatchSnapshot {
	return {
		steering: snapshotQueue(source.peekSteeringQueue(), reviser),
		followUp: snapshotQueue(source.peekFollowUpQueue(), reviser),
	};
}

/**
 * The batch the next request opens with, mirroring `Agent.continue()`:
 * steering wins when present; follow-ups only open a request when steering
 * is empty.
 */
export function resolveDispatchTarget(snapshot: DispatchBatchSnapshot): QueuedMessageRef[] {
	if (snapshot.steering.length > 0) return [...snapshot.steering];
	return [...snapshot.followUp];
}

/**
 * Reserve the currently queued batch for the next dispatch. Returns undefined
 * when both queues are empty — nothing to dispatch, nothing to classify.
 */
export function reserveDispatchBatch(
	source: QueuedMessageSource,
	reviser: DispatchReviser,
	generation: number,
	modelKey: string,
): DispatchBatchReservation | undefined {
	const snapshot = snapshotQueues(source, reviser);
	const target = resolveDispatchTarget(snapshot);
	if (target.length === 0) return undefined;
	return {
		id: reviser.nextReservationId(),
		generation,
		modelKey,
		target,
		snapshot,
	};
}

/**
 * True when the reserved batch is still exactly what the next request would
 * dispatch: same generation, same model, and both queues still hold the same
 * message objects in the same order.
 */
export function isReservationCurrent(
	source: QueuedMessageSource,
	reviser: DispatchReviser,
	reservation: DispatchBatchReservation,
	now: ReservationNow,
): boolean {
	if (now.generation !== reservation.generation) return false;
	if (now.modelKey !== reservation.modelKey) return false;
	const live = snapshotQueues(source, reviser);
	return (
		sameReservedBatch(live.steering, reservation.snapshot.steering) &&
		sameReservedBatch(live.followUp, reservation.snapshot.followUp)
	);
}

/** Order-sensitive batch identity by message object identity. */
export function sameReservedBatch(a: readonly QueuedMessageRef[], b: readonly QueuedMessageRef[]): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index++) {
		if (a[index].message !== b[index].message) return false;
	}
	return true;
}

/**
 * Whether the reserved batch contains real user work. Synthetic/agent-
 * originated continuations (developer-role directives, advisor cards) must
 * dispatch without paying another classifier call.
 */
export function reservationHasUserWork(reservation: DispatchBatchReservation): boolean {
	return reservation.target.some(ref => {
		const message = ref.message;
		if (message.role === "user") return true;
		return message.role === "custom" && isUserInvokedSkillPrompt(message);
	});
}
