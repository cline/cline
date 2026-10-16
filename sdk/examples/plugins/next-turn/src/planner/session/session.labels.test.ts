import { describe, expect, test } from "bun:test";
import { editRun, message } from "../../test-support/agent-runs";
import { useTempDirs } from "../../test-support/temp-dirs";
import { toTrayActions } from "../tray/verbs";
import { sessionHarness } from "./session.fixtures";

const tempDir = useTempDirs("next-turn-session-");
const harness = sessionHarness(tempDir);

describe("Next, for one chat", () => {
	test("the person's next message is labelled against the set on screen, then the set is superseded", async () => {
		const sent = harness({ complete: undefined });
		const run = editRun();
		const set = await sent.session.afterRun(run.result);
		sent.session.outgoing(run.messages);
		expect(sent.session.current()).toBe(set);
		sent.session.outgoing([
			...run.messages,
			message("user", set?.candidates[1]?.prompt ?? ""),
		]);
		expect(sent.session.current()).toBeUndefined();
		expect(sent.labels().map((record) => record.event)).toEqual([
			"offer",
			"do",
			"superseded",
		]);
		expect(sent.labels()[1]).toMatchObject({
			candidateId: set?.candidates[1]?.id,
			rank: 2,
			offerId: set?.offerId,
		});

		const adjusted = harness({ complete: undefined });
		const second = editRun();
		await adjusted.session.afterRun(second.result);
		adjusted.session.outgoing([
			...second.messages,
			message("user", "Do the next task: Ship the tray, then tag it"),
		]);
		expect(adjusted.labels()[1]).toMatchObject({
			event: "adjust",
			bucket: "small",
			rank: 1,
		});

		const typed = harness({ complete: undefined });
		const third = editRun();
		await typed.session.afterRun(third.result);
		typed.session.outgoing([
			...third.messages,
			message("user", "Deploy it before the tray was seen"),
		]);
		expect(typed.labels().map((record) => record.event)).toEqual([
			"offer",
			"superseded",
		]);
		await typed.session.afterRun(editRun("Another turn").result);
		typed.session.invoke({ type: "exposed" });
		typed.session.outgoing([
			...third.messages,
			message("user", "Deploy it to staging"),
		]);
		expect(
			typed.labels().find((record) => record.event === "typed_instead"),
		).toMatchObject({ chars: "Deploy it to staging".length });
		expect(JSON.stringify(typed.labels())).not.toContain("staging");
	});

	test("a Use the tray cleared no longer explains the next message, which is labelled from its text", async () => {
		const { session, labels } = harness({ complete: undefined });
		const run = editRun();
		const set = await session.afterRun(run.result);
		const [used, typed] = set?.candidates ?? [];
		const offerId = set?.offerId ?? "";
		session.invoke({ type: "exposed", offerId, candidateId: used?.id });
		session.invoke({ type: "use", candidateId: used?.id ?? "", offerId });
		for (const action of toTrayActions({
			verb: "clear",
			revision: offerId,
			itemId: used?.id ?? "",
		}) ?? [])
			session.invoke(action);
		session.outgoing([...run.messages, message("user", typed?.prompt ?? "")]);
		expect(labels().map((record) => record.event)).toEqual([
			"offer",
			"exposed",
			"adjust",
			"undo_adjust",
			"do",
			"superseded",
		]);
		expect(labels().find((record) => record.event === "do")).toMatchObject({
			candidateId: typed?.id,
			input: "message",
		});
	});

	test("a clear that names another row or another set keeps the Use it does not name", async () => {
		for (const clear of ["another row", "another set"] as const) {
			const { session, labels } = harness({ complete: undefined });
			const run = editRun();
			const set = await session.afterRun(run.result);
			const [used, other] = set?.candidates ?? [];
			const offerId = set?.offerId ?? "";
			session.invoke({ type: "use", candidateId: used?.id ?? "", offerId });
			for (const action of toTrayActions({
				verb: "clear",
				revision: clear === "another set" ? "offer_other" : offerId,
				itemId: (clear === "another set" ? used : other)?.id ?? "",
			}) ?? [])
				session.invoke(action);
			session.outgoing([
				...run.messages,
				message("user", `${used?.prompt} now`),
			]);
			expect([
				clear,
				labels().find((record) => record.event === "adjust_sent"),
			]).toEqual([clear, expect.objectContaining({ candidateId: used?.id })]);
		}
	});

	test("a row sent inside the runtime's input wrapper and mode notice is labelled as that row", async () => {
		const { session, labels } = harness({ complete: undefined });
		const run = editRun();
		const set = await session.afterRun(run.result);
		const row = set?.candidates[1];
		session.invoke({
			type: "send",
			candidateId: row?.id ?? "",
			input: "click",
		});
		session.outgoing([
			...run.messages,
			message(
				"user",
				`<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice><user_input mode="act">${row?.prompt}</user_input>`,
			),
		]);
		expect(labels().map((record) => record.event)).toEqual([
			"offer",
			"do",
			"superseded",
		]);
		expect(labels()[1]).toMatchObject({ candidateId: row?.id, input: "click" });
	});

	test("a label the tray passes through is stamped with this session and the offer it names", async () => {
		const { session, labels } = harness();
		await session.afterRun(editRun().result);
		await session.settled();
		session.invoke({
			type: "label",
			event: "key_inert",
			fields: { key: "cmd_2", reason: "exhausted", sessionId: "sess_other" },
		});
		expect(labels().find((r) => r.event === "key_inert")).toMatchObject({
			sessionId: "sess_1",
			offerId: session.current()?.offerId,
			key: "cmd_2",
			reason: "exhausted",
		});
		session.invoke({
			type: "label",
			event: "refused_stale",
			offerId: "offer_gone",
			fields: { reason: "set_changed" },
		});
		const stale = labels().find((r) => r.event === "refused_stale");
		expect(stale).toMatchObject({ offerId: "offer_gone", turnKey: "sess_1:1" });
		expect(stale?.setId).toBeUndefined();
	});
});
