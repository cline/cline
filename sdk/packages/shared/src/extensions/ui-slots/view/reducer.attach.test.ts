import { describe, expect, it } from "vitest";
import {
	bound,
	EPOCH,
	envelope,
	nextSet,
	readyThree,
	reduce,
	reply,
	SESSION,
	stateEvent,
	states,
} from "./harness";

describe("epoch re-attach", () => {
	const attached = bound(
		{ type: "attached", sessionId: SESSION, outcome: "ok", epoch: EPOCH },
		stateEvent(envelope(readyThree, 1)),
	);

	it("is due for an envelope with a newer epoch, and cleared by attached", () => {
		const due = reduce(
			attached,
			stateEvent(envelope(readyThree, 1, { epoch: EPOCH + 5 })),
		);
		expect(due.attachDue).toBe(true);

		const reattached = reduce(due, {
			type: "attached",
			sessionId: SESSION,
			outcome: "ok",
			epoch: EPOCH + 5,
		});
		expect(reattached.attachDue).toBe(false);
		expect(reattached.boundEpoch).toBe(EPOCH + 5);
	});

	it("is never due before the first attach reply", () => {
		const local = bound(
			stateEvent(envelope(readyThree, 1)),
			stateEvent(envelope(readyThree, 1, { epoch: EPOCH + 5 })),
		);

		expect(local.attachDue).toBe(false);
	});

	it("is due once per epoch when the re-attach reply carries no epoch", () => {
		const due = reduce(
			attached,
			stateEvent(envelope(readyThree, 1, { epoch: EPOCH + 5 })),
		);
		const answered = reduce(due, {
			type: "attached",
			sessionId: SESSION,
			outcome: "unavailable",
		});

		expect(answered.attachDue).toBe(false);
		expect(answered.boundEpoch).toBe(EPOCH);
		expect(
			reduce(answered, stateEvent(envelope(nextSet, 2, { epoch: EPOCH + 5 })))
				.attachDue,
		).toBe(false);
		expect(
			reduce(answered, stateEvent(envelope(nextSet, 1, { epoch: EPOCH + 9 })))
				.attachDue,
		).toBe(true);
	});

	it("is due once for the first state after an attach that found the session not resident", () => {
		const unanswered = bound({
			type: "attached",
			sessionId: SESSION,
			outcome: "unavailable",
		});

		const due = reduce(unanswered, stateEvent(envelope(readyThree, 1)));
		expect(due.attachDue).toBe(true);
		expect(due.attachDueFor).toBe(EPOCH);

		const stillUnanswered = reduce(
			due,
			{ type: "attached", sessionId: SESSION, outcome: "unavailable" },
			stateEvent(envelope(nextSet, 2)),
		);
		expect(stillUnanswered.attachDue).toBe(false);
	});

	it("is due once within the epoch of an attach that timed out", () => {
		const timedOut = bound(stateEvent(envelope(readyThree, 1)), {
			type: "attached",
			sessionId: SESSION,
			outcome: "timeout",
			epoch: EPOCH,
		});
		expect(timedOut.boundEpoch).toBe(EPOCH);
		expect(timedOut.attachDue).toBe(false);

		const due = reduce(timedOut, stateEvent(envelope(nextSet, 2)));
		expect(due.attachDue).toBe(true);
		expect(due.attachDueFor).toBe(EPOCH);

		const timedOutAgain = reduce(
			due,
			{
				type: "attached",
				sessionId: SESSION,
				outcome: "timeout",
				epoch: EPOCH,
			},
			stateEvent(envelope(readyThree, 3)),
		);
		expect(timedOutAgain.attachDue).toBe(false);
	});

	it("is not due within the attached epoch after an attach that answered with it", () => {
		for (const outcome of ["ok", "unavailable"] as const) {
			const answered = bound(stateEvent(envelope(readyThree, 1)), {
				type: "attached",
				sessionId: SESSION,
				outcome,
				epoch: EPOCH,
			});

			expect(reduce(answered, stateEvent(envelope(nextSet, 2))).attachDue).toBe(
				false,
			);
		}
	});

	describe("after an attach that timed out with the plugin's state already held", () => {
		const timedOut = {
			type: "attached",
			sessionId: SESSION,
			outcome: "timeout",
			epoch: EPOCH,
		} as const;
		const dormant = envelope(states.hidden, 1);

		it("re-attaches when the next run ends, when the timed-out reply carried the state", () => {
			const local = bound(
				reply({ outcome: "timeout", epoch: EPOCH, state: dormant }),
				timedOut,
				{ type: "run_started" },
			);
			expect(local.attachDue).toBe(false);

			expect(reduce(local, { type: "run_ended" }).attachDue).toBe(true);
		});

		it("re-attaches when the next run ends, when the state arrived before the reply", () => {
			const local = bound(stateEvent(dormant), timedOut);
			expect(local.attachDue).toBe(false);

			expect(reduce(local, { type: "run_ended" }).attachDue).toBe(true);
		});

		it("re-attaches when the next run ends even after the state's own re-attach timed out", () => {
			const local = bound(
				timedOut,
				stateEvent(dormant),
				timedOut,
				stateEvent(envelope(states.hidden, 2)),
			);
			expect(local.attachDue).toBe(false);

			expect(reduce(local, { type: "run_ended" }).attachDue).toBe(true);
		});

		it("re-attaches at a run end at most once per epoch", () => {
			const retried = reduce(
				bound(stateEvent(dormant), timedOut),
				{ type: "run_ended" },
				timedOut,
			);

			expect(reduce(retried, { type: "run_ended" }).attachDue).toBe(false);
			expect(
				reduce(
					retried,
					stateEvent(envelope(states.hidden, 1, { epoch: EPOCH + 5 })),
					{
						type: "attached",
						sessionId: SESSION,
						outcome: "timeout",
						epoch: EPOCH + 5,
					},
					{ type: "run_ended" },
				).attachDue,
			).toBe(true);
		});

		it("does not re-attach at a run end once an attach answered", () => {
			const answered = reduce(bound(stateEvent(dormant), timedOut), {
				type: "attached",
				sessionId: SESSION,
				outcome: "ok",
				epoch: EPOCH,
			});

			expect(reduce(answered, { type: "run_ended" })).toBe(answered);
		});

		it("does not re-attach at a run end for a hub that never named an epoch", () => {
			const unanswered = bound({
				type: "attached",
				sessionId: SESSION,
				outcome: "unavailable",
			});

			expect(reduce(unanswered, { type: "run_ended" })).toBe(unanswered);
		});
	});
});
