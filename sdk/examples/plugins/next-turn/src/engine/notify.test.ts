import { describe, expect, test } from "bun:test";
import { ASK_QUESTION_CAPABILITY, foldEvent } from "../hub/fold/fold";
import { emptyFold } from "../hub/fold/state";
import type { HubEvent } from "../hub/link";
import { NotifyGate, waitingOn } from "./notify";

describe("NotifyGate", () => {
	const approval = (id: string) =>
		({ key: `approval:${id}`, kind: "approval", sessionId: "s" }) as const;

	test("one notification per interval; held items are not sent later", () => {
		let now = 0;
		const gate = new NotifyGate({
			enabled: () => true,
			minIntervalMs: 60,
			now: () => now,
		});
		expect(gate.take([approval("a")])?.title).toBe(
			"Cline is waiting for your approval",
		);
		now = 10;
		expect(gate.take([approval("b")])).toBeUndefined();
		now = 100;
		expect(gate.take([approval("b")])).toBeUndefined();
		expect(gate.take([approval("c"), approval("d")])?.body).toBe(
			"2 approvals or questions in this chat. Open it to answer.",
		);
	});

	test("an item offered while notifications are off is not sent once they are on", () => {
		let enabled = false;
		const gate = new NotifyGate({ enabled: () => enabled, minIntervalMs: 0 });
		expect(gate.take([approval("a")])).toBeUndefined();
		enabled = true;
		expect(gate.take([approval("a")])).toBeUndefined();
		expect(gate.take([approval("a"), approval("b")])?.title).toBe(
			"Cline is waiting for your approval",
		);
	});

	test("a session's approvals and questions are what it waits on", () => {
		const events: HubEvent[] = [
			{
				event: "approval.requested",
				payload: { approvalId: "a1", sessionId: "s", toolName: "bash" },
			},
			{
				event: "capability.requested",
				sessionId: "s",
				payload: { requestId: "q1", capabilityName: ASK_QUESTION_CAPABILITY },
			},
		];
		const session = events.reduce(foldEvent, emptyFold()).sessions.s;
		if (!session) throw new Error("the session was not folded");
		expect(waitingOn(session)).toEqual([
			{
				key: "approval:a1",
				kind: "approval",
				sessionId: "s",
				toolName: "bash",
			},
			{ key: "question:q1", kind: "question", sessionId: "s" },
		]);
		const gate = new NotifyGate({ enabled: () => true, minIntervalMs: 0 });
		expect(gate.take(waitingOn(session).slice(1))).toMatchObject({
			title: "Cline asked you a question",
			sessionId: "s",
		});
	});
});
