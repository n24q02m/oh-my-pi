import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	DispatchReviser,
	isReservationCurrent,
	type QueuedMessageSource,
	reservationHasUserWork,
	reserveDispatchBatch,
	resolveDispatchTarget,
	sameReservedBatch,
	snapshotQueues,
} from "@oh-my-pi/pi-coding-agent/session/dispatch-reservation";
import { SKILL_PROMPT_MESSAGE_TYPE } from "@oh-my-pi/pi-coding-agent/session/messages";

function userMessage(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 };
}

function developerMessage(text: string): AgentMessage {
	return { role: "developer", content: [{ type: "text", text }], timestamp: 0 };
}

function skillMessage(text: string): AgentMessage {
	return {
		role: "custom",
		customType: SKILL_PROMPT_MESSAGE_TYPE,
		content: [{ type: "text", text }],
		display: true,
		attribution: "user",
		timestamp: 0,
	};
}

/** Minimal structural queue source — Agent satisfies this surface. */
function fakeQueueSource(
	steering: AgentMessage[],
	followUp: AgentMessage[],
): QueuedMessageSource & {
	steering: AgentMessage[];
	followUp: AgentMessage[];
} {
	return {
		steering,
		followUp,
		peekSteeringQueue: () => steering,
		peekFollowUpQueue: () => followUp,
	};
}

describe("dispatch batch snapshot", () => {
	it("snapshots both queues with monotonic per-message revisions", () => {
		const reviser = new DispatchReviser();
		const first = userMessage("one");
		const second = userMessage("two");
		const source = fakeQueueSource([first, second], []);

		const snapshot = snapshotQueues(source, reviser);
		expect(snapshot.steering).toHaveLength(2);
		expect(snapshot.steering[0].message).toBe(first);
		expect(snapshot.steering[1].message).toBe(second);
		expect(snapshot.steering[0].revision).toBeLessThan(snapshot.steering[1].revision);
		expect(snapshot.steering[0].text).toBe("one");
	});

	it("keeps a message's revision stable across observations", () => {
		const reviser = new DispatchReviser();
		const message = userMessage("stable");
		const firstSnapshot = snapshotQueues(fakeQueueSource([message], []), reviser);
		const secondSnapshot = snapshotQueues(fakeQueueSource([message], []), reviser);
		expect(secondSnapshot.steering[0].revision).toBe(firstSnapshot.steering[0].revision);
	});
});

describe("dispatch target resolution", () => {
	it("prefers steering messages, mirroring agent-core dequeue order", () => {
		const target = resolveDispatchTarget({
			steering: [{ message: userMessage("s"), revision: 1, text: "s" }],
			followUp: [{ message: userMessage("f"), revision: 2, text: "f" }],
		});
		expect(target).toHaveLength(1);
		expect(target[0].text).toBe("s");
	});

	it("falls back to the follow-up queue when steering is empty", () => {
		const target = resolveDispatchTarget({
			steering: [],
			followUp: [{ message: userMessage("f"), revision: 2, text: "f" }],
		});
		expect(target).toHaveLength(1);
		expect(target[0].text).toBe("f");
	});

	it("resolves to an empty target when both queues are empty", () => {
		expect(resolveDispatchTarget({ steering: [], followUp: [] })).toEqual([]);
	});
});

describe("dispatch reservation lifecycle", () => {
	it("reserves generation, model key and the resolved target", () => {
		const reviser = new DispatchReviser();
		const source = fakeQueueSource([userMessage("steer during run")], [userMessage("queued follow-up")]);
		const reservation = reserveDispatchBatch(source, reviser, 7, "anthropic/claude-sonnet-4-5");
		expect(reservation).toBeDefined();
		expect(reservation!.generation).toBe(7);
		expect(reservation!.modelKey).toBe("anthropic/claude-sonnet-4-5");
		expect(reservation!.target.map(ref => ref.text)).toEqual(["steer during run"]);
	});

	it("returns undefined when there is nothing to dispatch", () => {
		const reservation = reserveDispatchBatch(fakeQueueSource([], []), new DispatchReviser(), 1, "m/x");
		expect(reservation).toBeUndefined();
	});

	it("stays current while queues, generation and model are unchanged", () => {
		const reviser = new DispatchReviser();
		const source = fakeQueueSource([userMessage("s")], []);
		const reservation = reserveDispatchBatch(source, reviser, 3, "m/x");
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 3, modelKey: "m/x" })).toBe(true);
	});

	it("invalidates when a concurrent enqueue lands after reservation", () => {
		const reviser = new DispatchReviser();
		const steering = [userMessage("s")];
		const source = fakeQueueSource(steering, []);
		const reservation = reserveDispatchBatch(source, reviser, 3, "m/x");
		steering.push(userMessage("late steer"));
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 3, modelKey: "m/x" })).toBe(false);
	});

	it("invalidates on queue edit (message removed) and reorder", () => {
		const reviser = new DispatchReviser();
		const first = userMessage("first");
		const second = userMessage("second");
		const steering = [first, second];
		const source = fakeQueueSource(steering, []);
		const reservation = reserveDispatchBatch(source, reviser, 3, "m/x");

		steering.shift(); // dequeue keybinding removed the oldest
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 3, modelKey: "m/x" })).toBe(false);

		steering.unshift(second, first); // same members, different order
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 3, modelKey: "m/x" })).toBe(false);
	});

	it("invalidates on generation bump (abort/new session) and model switch", () => {
		const reviser = new DispatchReviser();
		const source = fakeQueueSource([userMessage("s")], []);
		const reservation = reserveDispatchBatch(source, reviser, 3, "m/x");
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 4, modelKey: "m/x" })).toBe(false);
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 3, modelKey: "m/y" })).toBe(false);
	});

	it("replaces queue contents wholesale on cancel-and-requeue", () => {
		const reviser = new DispatchReviser();
		const source = fakeQueueSource([userMessage("old batch")], []);
		const reservation = reserveDispatchBatch(source, reviser, 3, "m/x");
		source.steering.length = 0;
		source.steering.push(userMessage("replacement batch"));
		expect(isReservationCurrent(source, reviser, reservation!, { generation: 3, modelKey: "m/x" })).toBe(false);
	});
});

describe("batch identity", () => {
	it("matches identical reserved batches and rejects changed ones", () => {
		const reviser = new DispatchReviser();
		const a = userMessage("a");
		const b = userMessage("b");
		const refsAB = snapshotQueues(fakeQueueSource([a, b], []), reviser).steering;
		const refsABAgain = snapshotQueues(fakeQueueSource([a, b], []), reviser).steering;
		const refsBA = snapshotQueues(fakeQueueSource([b, a], []), reviser).steering;
		const refsA = snapshotQueues(fakeQueueSource([a], []), reviser).steering;

		expect(sameReservedBatch(refsAB, refsABAgain)).toBe(true);
		expect(sameReservedBatch(refsAB, refsBA)).toBe(false);
		expect(sameReservedBatch(refsAB, refsA)).toBe(false);
		expect(sameReservedBatch([], [])).toBe(true);
	});
});

describe("user-work detection", () => {
	it("accepts user messages and user-invoked skill prompts", () => {
		const reviser = new DispatchReviser();
		const userReservation = reserveDispatchBatch(fakeQueueSource([userMessage("hi")], []), reviser, 1, "m/x");
		const skillReservation = reserveDispatchBatch(fakeQueueSource([skillMessage("run plan")], []), reviser, 1, "m/x");
		expect(reservationHasUserWork(userReservation!)).toBe(true);
		expect(reservationHasUserWork(skillReservation!)).toBe(true);
	});

	it("rejects agent-originated synthetic batches", () => {
		const reviser = new DispatchReviser();
		const reservation = reserveDispatchBatch(
			fakeQueueSource([], [developerMessage("approved plan execution")]),
			reviser,
			1,
			"m/x",
		);
		expect(reservationHasUserWork(reservation!)).toBe(false);
	});
});
