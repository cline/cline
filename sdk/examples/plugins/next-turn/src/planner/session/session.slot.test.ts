import { describe, expect, test } from "bun:test";
import type { ContextSource } from "../../context/source";
import { defaultSettings } from "../../settings/settings";
import { FileSessionStateStore } from "../../store/session-state";
import { editRun, message, runResult } from "../../test-support/agent-runs";
import { useTempDirs } from "../../test-support/temp-dirs";
import { EMPTY_BACKLOG } from "../backlog";
import type { TrayPush } from "../tray/tray";
import { sessionHarness, sources } from "./session.fixtures";

const tempDir = useTempDirs("next-turn-session-");
const harness = sessionHarness(tempDir);

describe("Next behind Cline's composer.suggestions slot", () => {
	test("Send on an outward row or a connector's row is refused and labelled, and Use still takes it", async () => {
		const slack: ContextSource = {
			id: "slack",
			tier: "T3",
			probe: () => "present",
			capabilities: () => ["slack"],
		};
		const github: ContextSource = {
			id: "github",
			tier: "T3",
			probe: () => "present",
			capabilities: () => ["github", "github:gh"],
		};
		const remote: ContextSource = {
			id: "git",
			tier: "T1",
			probe: () => "present",
			capabilities: () => ["remote:github"],
		};
		const { session, labels } = harness({
			sources: () => [sources[0] as ContextSource, remote, slack, github],
			backlog: async () => EMPTY_BACKLOG,
			github: () => ({ failingChecks: ["build"] }),
			complete: async () => ({
				text: '{"suggestions":[{"kind":"post_update","source":"tasks","prompt":"Post the release note to the team.","why":"Slack is connected"}]}',
			}),
		});
		const { result, messages } = editRun();
		const rules = await session.afterRun(result);
		const connectorRow = rules?.candidates.find(
			(row) => row.source === "connector",
		);
		expect(connectorRow?.kind).toBe("check_ci");
		expect(
			session.invoke({
				type: "send",
				candidateId: connectorRow?.id ?? "",
				offerId: rules?.offerId,
				input: "key",
			}).refused,
		).toBe("unsendable");
		await session.settled();
		const model = session.current();
		const outwardRow = model?.candidates.find((row) => row.outward);
		expect(outwardRow?.kind).toBe("post_update");
		expect(
			session.invoke({
				type: "send",
				candidateId: outwardRow?.id ?? "",
				offerId: model?.offerId,
				input: "pointer",
			}).refused,
		).toBe("unsendable");
		expect(
			labels()
				.filter((record) => record.event === "key_inert")
				.map((record) => [record.candidateId, record.reason]),
		).toEqual([
			[connectorRow?.id, "unsendable"],
			[outwardRow?.id, "unsendable"],
		]);
		expect(
			session.invoke({
				type: "use",
				candidateId: outwardRow?.id ?? "",
				offerId: model?.offerId,
				input: "key",
			}).refused,
		).toBeUndefined();
		session.outgoing([
			...messages,
			message("user", `${outwardRow?.prompt} today`),
		]);
		expect(labels().find((r) => r.event === "adjust_sent")).toMatchObject({
			candidateId: outwardRow?.id,
		});
	});

	test("an action naming a set when none is on screen is refused as stale, after off and while a run is going", async () => {
		const offerVerbs = (offerId: string | undefined, candidateId: string) => [
			{ type: "use" as const, candidateId, offerId },
			{ type: "send" as const, candidateId, offerId },
			{ type: "skip" as const, candidateId, offerId },
			{ type: "unskip" as const, candidateId, offerId },
			{ type: "exposed" as const, candidateId, offerId },
			{ type: "reroll" as const, offerId },
		];
		const off = harness({ complete: undefined });
		const turned = await off.session.afterRun(editRun().result);
		off.session.off();
		for (const action of offerVerbs(
			turned?.offerId,
			turned?.candidates[0]?.id ?? "",
		))
			expect([action.type, off.session.invoke(action).refused]).toEqual([
				action.type,
				"stale",
			]);

		const running = harness({ complete: undefined });
		const first = editRun();
		const shown = await running.session.afterRun(first.result);
		running.session.outgoing([
			...first.messages,
			message("user", "Now the parser"),
		]);
		for (const action of offerVerbs(
			shown?.offerId,
			shown?.candidates[0]?.id ?? "",
		))
			expect([action.type, running.session.invoke(action).refused]).toEqual([
				action.type,
				"stale",
			]);
		expect(running.sets.filter(Boolean)).toHaveLength(1);
	});

	test("off says why: a message, a hidden chat or Next turned off", async () => {
		const settings = defaultSettings();
		const { session } = harness({ complete: undefined }, settings);
		const run = editRun();
		await session.afterRun(run.result);
		session.outgoing([...run.messages, message("user", "Now the parser")]);
		expect(session.currentPush()).toMatchObject({
			state: "off",
			offReason: "message",
		});
		const superseded = session.currentPush();
		session.invoke({ type: "hide", scope: "chat" });
		expect(session.currentPush()).toMatchObject({
			state: "off",
			offReason: "hidden",
		});
		expect(session.currentPush().seq).toBe(superseded.seq + 1);
		expect(await session.ensureCurrent()).toMatchObject({
			offReason: "hidden",
		});
		await session.afterRun(editRun("Another turn").result);
		expect(session.currentPush().offReason).toBe("hidden");

		const disabled = harness({ complete: undefined }, settings);
		settings.features.next = false;
		await disabled.session.afterRun(editRun().result);
		expect(disabled.session.currentPush()).toMatchObject({
			state: "off",
			offReason: "disabled",
		});
		expect(await disabled.session.ensureCurrent()).toMatchObject({
			offReason: "disabled",
		});
	});

	test("show turns a hidden chat's tray into a plain off when there is no turn to serve or a run is going, then serves the next turn", async () => {
		const unknown = harness({ complete: undefined });
		unknown.session.invoke({ type: "hide", scope: "chat" });
		unknown.session.show();
		expect(await unknown.session.ensureCurrent()).toMatchObject({
			state: "off",
			offReason: "message",
		});

		const running = harness({ complete: undefined });
		const first = editRun();
		await running.session.afterRun(first.result);
		running.session.invoke({ type: "hide", scope: "chat" });
		running.session.outgoing([
			...first.messages,
			message("user", "Now the parser"),
		]);
		running.session.show();
		expect(await running.session.ensureCurrent()).toMatchObject({
			state: "off",
			offReason: "message",
		});
		await running.session.afterRun(editRun("Now the parser").result);
		expect(running.session.currentPush().state).toBe("ready");
	});

	test("a turn that ends while nobody is viewing is recorded without a set or a planner call, and the next viewer gets that turn", async () => {
		let viewed = true;
		const { session, sets, calls } = harness({ viewed: () => viewed });
		const run = editRun();
		await session.afterRun(run.result);
		await session.settled();
		const pushes: TrayPush[] = [];
		session.onPush((push) => pushes.push(push));
		viewed = false;
		const callsBefore = calls.length;
		const unseen = runResult([
			...run.messages,
			message("assistant", "Done."),
			message("user", "A turn nobody saw"),
		]);
		expect(await session.afterRun(unseen)).toBeUndefined();
		await session.settled();
		expect(pushes).toEqual([]);
		expect(calls).toHaveLength(callsBefore);
		expect(session.current()).toBeUndefined();
		expect(session.turn()?.runCount).toBe(2);
		viewed = true;
		const reply = await session.ensureCurrent();
		expect(reply).toMatchObject({
			state: "ready",
			set: { runCount: 2, trigger: "on_demand" },
		});
		expect(sets.at(-1)?.runCount).toBe(2);
	});

	test("a viewer who leaves while the transcript is read starts no serve or planner call, and the next attach serves the turn", async () => {
		let viewed = true;
		let release: () => void = () => {};
		const read = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { messages } = editRun("Forked chat turn");
		const { session, sets, calls, ledgerCalls } = harness({
			viewed: () => viewed,
			readTranscript: async () => {
				await read;
				return { messages, status: "completed" };
			},
		});
		const reply = session.ensureCurrent();
		viewed = false;
		release();
		expect((await reply).state).toBe("off");
		await session.settled();
		expect([sets.filter(Boolean), calls, ledgerCalls()]).toEqual([[], [], []]);

		viewed = true;
		expect((await session.ensureCurrent()).state).toBe("ready");
		await session.settled();
		expect(calls).toHaveLength(1);
		expect(session.current()?.planner).toBe("model");
	});

	test("a viewer who leaves while a turn's serve reads git gets the rule-based set, and the planner waits for the next attach", async () => {
		let viewed = true;
		let gitRead: () => void = () => {};
		const reading = new Promise<void>((resolve) => {
			gitRead = resolve;
		});
		let releaseGit: () => void = () => {};
		const { session, calls, ledgerCalls } = harness({
			viewed: () => viewed,
			dirtyFiles: () => {
				gitRead();
				return new Promise((resolve) => {
					releaseGit = () => resolve(2);
				});
			},
		});
		const served = session.afterRun(editRun().result);
		await reading;
		viewed = false;
		releaseGit();
		expect((await served)?.planner).toBe("rules");
		await session.settled();
		expect([calls, ledgerCalls()]).toEqual([[], []]);
		expect(session.current()?.model?.status).toBe("pending");

		viewed = true;
		expect((await session.ensureCurrent()).set?.planner).toBe("rules");
		await session.settled();
		expect(calls).toHaveLength(1);
		expect(session.current()?.planner).toBe("model");
	});

	test("a planner call held back for a chat nobody views reads neither the backlog nor any source's facts, in this worker or a respawned one, until a viewer attaches", async () => {
		const store = new FileSessionStateStore(tempDir("held-planner-"), "sess_1");
		let viewed = true;
		const reads: string[] = [];
		const counted: ContextSource[] = [
			...sources,
			{
				id: "notes",
				tier: "T1",
				probe: () => "present",
				facts: () => {
					reads.push("facts");
					return { heading: "Notes", lines: ["Ship on Friday"] };
				},
			},
		];
		const backlog = async () => {
			reads.push("backlog");
			return EMPTY_BACKLOG;
		};
		const first = harness({
			store,
			viewed: () => viewed,
			sources: () => counted,
			backlog,
			dirtyFiles: async () => {
				viewed = false;
				return 2;
			},
		});
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		first.session.invoke({ type: "reroll" });
		await first.session.settled();
		expect(first.session.currentPush()).toMatchObject({
			state: "computing",
			computingFor: "reroll",
		});

		const respawned = harness({
			store,
			viewed: () => viewed,
			sources: () => counted,
			backlog,
		});
		await respawned.session.settled();
		expect([reads, first.calls, respawned.calls]).toEqual([
			["backlog"],
			[],
			[],
		]);

		viewed = true;
		await respawned.session.ensureCurrent();
		await respawned.session.settled();
		expect(reads).toEqual(["backlog", "backlog", "facts"]);
		expect(respawned.calls).toHaveLength(1);
	});

	test("a planner call a detach held back is answered from the rules at the next attach once the allowance ran out, and so is a held reroll", async () => {
		const settings = defaultSettings();
		const allowance = settings.planner.callsPerHour;
		let viewed = true;
		const { session, calls } = harness({ viewed: () => viewed }, settings);
		const served = session.afterRun(editRun().result);
		viewed = false;
		await served;
		await session.settled();
		settings.planner.callsPerHour = 0;
		viewed = true;
		const resumed = await session.ensureCurrent();
		expect(resumed).toMatchObject({
			state: "ready",
			set: { planner: "rules", model: { status: "paused" } },
		});
		expect(resumed.set?.paused?.resetsAt).toBeGreaterThan(0);

		settings.planner.callsPerHour = allowance;
		const shown = session.current();
		expect(
			session.invoke({ type: "reroll", offerId: shown?.offerId }).push,
		).toMatchObject({ state: "computing", computingFor: "reroll" });
		viewed = false;
		await session.settled();
		settings.planner.callsPerHour = 0;
		viewed = true;
		const page = await session.ensureCurrent();
		expect(page.state).not.toBe("computing");
		expect(page.set?.offerId).not.toBe(shown?.offerId);
		expect(calls).toEqual([]);
	});
});
