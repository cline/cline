import { describe, expect, test } from "bun:test";
import type { ContextSource } from "../../context/source";
import { defaultSettings } from "../../settings/settings";
import { editRun, message, runResult } from "../../test-support/agent-runs";
import { useTempDirs } from "../../test-support/temp-dirs";
import { EMPTY_BACKLOG } from "../backlog";
import type { TrayPush } from "../tray/tray";
import { env, MODEL_ANSWER, sessionHarness, sources } from "./session.fixtures";

const tempDir = useTempDirs("next-turn-session-");
const harness = sessionHarness(tempDir);

describe("Next, for one chat", () => {
	test("afterRun serves one set per turn: the tray loads until the planner answers, and the rule set never shows first", async () => {
		const { session, sets, calls, labels, ledgerCalls } = harness();
		const { result } = editRun();
		expect(await session.afterRun(result)).toBeUndefined();
		expect(session.currentPush()).toMatchObject({
			state: "computing",
			computingFor: "turn",
		});
		expect(session.current()).toBeUndefined();
		await session.settled();
		const model = session.current();
		expect(model?.planner).toBe("model");
		expect(model?.candidates[0]?.prompt).toBe(
			"Run bun test src/client.test.ts.",
		);
		expect(sets.map((set) => set?.planner)).toEqual(["model"]);
		expect(calls[0]).toContain(
			"## This repository's commands\n- bun run check",
		);
		expect(calls[0]).not.toContain("Status Hub");
		const offers = labels().filter((record) => record.event === "offer");
		expect(offers.map((record) => record.planner)).toEqual(["model"]);
		expect(labels().some((record) => record.event === "superseded")).toBe(
			false,
		);
		expect(offers[0]).toMatchObject({
			runId: result.runId,
			turnKey: "sess_1:1",
			kinds: ["verify", "wrap_up", "continue"],
		});
		expect(offers[0]?.tags).toEqual(
			expect.arrayContaining([
				"source:tasks:present",
				"source:status:absent",
				"client:cline-cli",
			]),
		);
		expect(ledgerCalls()).toHaveLength(1);
		expect(ledgerCalls()[0]?.costUsd).toBe(0.001);
	});

	test("the planner names a source it could not read by the source's own display name, or its id without one", async () => {
		const { session, calls } = harness({
			sources: () => [
				...sources.filter((source) => source.id !== "tasks"),
				{
					id: "tasks",
					tier: "T2",
					displayName: "The task agenda",
					probe: () => "unknown",
				},
				{ id: "notes", tier: "T2", probe: () => "unknown" },
			],
		});
		await session.afterRun(editRun().result);
		await session.settled();
		expect(calls[0]).toContain(
			"- The task agenda — treat as unknown, not empty.",
		);
		expect(calls[0]).toContain("- notes — treat as unknown, not empty.");
	});

	test("without a model the rules answer at once; with the allowance used the set says it is paused", async () => {
		const rulesOnly = harness({ complete: undefined });
		const rules = await rulesOnly.session.afterRun(editRun().result);
		expect(rules?.planner).toBe("rules");
		expect(rules?.candidates.map((row) => row.prompt)).toEqual([
			"Do the next task: Ship the tray",
			"Run the checks for the files the last turn changed.",
			"Review the changes from the last turn before going on.",
		]);
		await rulesOnly.session.settled();
		expect(rulesOnly.sets.map((set) => set?.planner)).toEqual(["rules"]);
		const settings = defaultSettings();
		settings.planner.callsPerHour = 1;
		const paused = harness({}, settings);
		await paused.session.afterRun(editRun().result);
		await paused.session.settled();
		await paused.session.afterRun(editRun("And now a timeout").result);
		await paused.session.settled();
		expect(paused.calls).toHaveLength(1);
		expect(paused.session.current()?.paused?.resetsAt).toBeGreaterThan(0);
		expect(paused.session.current()?.planner).toBe("rules");
	});

	test("Next off, or a transcript with no message, serves nothing", async () => {
		const off = defaultSettings();
		off.features.next = false;
		const { session, sets } = harness({}, off);
		expect(await session.afterRun(editRun().result)).toBeUndefined();
		const empty = harness();
		expect(
			await empty.session.afterRun({ ...editRun().result, messages: [] }),
		).toBeUndefined();
		expect([...sets, ...empty.sets].filter(Boolean)).toEqual([]);
	});

	test("a model pool is reused on a resume and asked again for a new message at the same position", async () => {
		const asked: string[] = [];
		const { session } = harness({
			complete: async (input) => {
				asked.push(input.user);
				return {
					text: '{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run the flaky test ten times.","why":"it was flaky"}]}',
				};
			},
		});
		const resume =
			'<user_input mode="act">[TASK RESUMPTION] Please continue where you left off.</user_input>';
		const ask = message(
			"user",
			'<user_input mode="act">Fix the flaky test</user_input>',
		);
		await session.afterRun(runResult([ask]));
		await session.settled();
		await session.afterRun(runResult([ask, message("user", resume)]));
		await session.settled();
		expect(asked).toHaveLength(1);
		expect(session.current()?.planner).toBe("model");
		await session.afterRun(
			runResult([message("user", "Fix the parser instead")]),
		);
		await session.settled();
		expect(asked).toHaveLength(2);
	});

	test("a late model answer for an older turn is dropped", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { session, sets } = harness({
			complete: async () => {
				await gate;
				return { text: MODEL_ANSWER };
			},
		});
		const first = editRun();
		await session.afterRun(first.result);
		session.outgoing([...first.messages, message("user", "Something else")]);
		release();
		await session.settled();
		expect(sets.filter(Boolean)).toEqual([]);
		expect(session.currentPush()).toMatchObject({
			state: "off",
			offReason: "message",
		});
	});

	test("a follow-on run with no new message (a retry, a resume, an approved plan) takes the set down until it ends", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let asked = 0;
		const { session, sets, labels } = harness({
			complete: async () => {
				asked += 1;
				if (asked === 1) await gate;
				return { text: MODEL_ANSWER };
			},
		});
		const failed = editRun();
		await session.afterRun({ ...failed.result, status: "failed" });
		session.outgoing(failed.messages);
		release();
		await session.settled();
		expect(sets.filter(Boolean)).toEqual([]);
		expect(session.currentPush().state).toBe("off");

		await session.afterRun(failed.result);
		await session.settled();
		const shown = session.current();
		expect(shown?.planner).toBe("model");
		session.outgoing(failed.messages);
		expect(session.current()).toBeUndefined();
		expect(labels().at(-1)).toMatchObject({
			event: "superseded",
			cause: "run",
			offerId: shown?.offerId,
		});
		expect(labels().some((record) => record.event === "typed_instead")).toBe(
			false,
		);
	});

	test("a run sent in plan mode drops the Commit row and asks for planning requests until the plan is approved", async () => {
		const systems: string[] = [];
		const options = {
			sources: () => sources.filter((source) => source.id !== "tasks"),
			backlog: async () => EMPTY_BACKLOG,
		};
		const planned = editRun(
			'<user_input mode="plan">Plan the retry for the client</user_input>',
		);
		const modelled = harness({
			...options,
			complete: async (input) => {
				systems.push(input.system);
				return { text: MODEL_ANSWER };
			},
		});
		await modelled.session.afterRun(planned.result);
		await modelled.session.settled();
		expect(systems[0]).toContain("The chat is in plan mode");

		const { session, labels } = harness({ ...options, complete: undefined });
		const set = await session.afterRun(planned.result);
		expect(set?.candidates.map((row) => row.kind)).not.toContain("commit");
		expect(labels().find((record) => record.event === "offer")?.tags).toContain(
			"mode:plan",
		);
		const approval = message(
			"user",
			'<user_input mode="act">The user approved switching to act mode. Continue with the approved plan now.</user_input>',
		);
		const approved = await session.afterRun(
			runResult([...planned.messages, approval]),
		);
		expect(approved?.candidates.map((row) => row.kind)).toContain("commit");
	});

	test("skip and reroll serve new sets from the same turn; hide clears the tray", async () => {
		const { session, labels } = harness({ complete: undefined });
		const set = await session.afterRun(editRun().result);
		const first = set?.candidates[0];
		const skipped = session.invoke({
			type: "skip",
			candidateId: first?.id ?? "",
		}).push.set;
		expect(skipped?.candidates.map((row) => row.id)).not.toContain(first?.id);
		expect(skipped?.excluded).toEqual([first?.prompt ?? ""]);
		const rerolled = session.invoke({ type: "reroll" }).push.set;
		expect(
			rerolled?.candidates.some((row) =>
				skipped?.candidates.some((old) => old.id === row.id),
			),
		).toBe(false);
		session.invoke({ type: "exposed" });
		session.invoke({ type: "hide" });
		expect(session.current()).toBeUndefined();
		expect(labels().map((record) => record.event)).toEqual([
			"offer",
			"skip",
			"offer",
			"reroll",
			"offer",
			"exposed",
			"hidden_by_user",
		]);
		const afterHide = session.invoke({ type: "reroll" });
		expect(afterHide.refused).toBe("stale");
		expect(afterHide.push.set).toBeUndefined();
	});

	test("Check CI joins the set when GitHub is connected and the turn pushed", async () => {
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
		const { session } = harness({
			complete: undefined,
			sources: () => [sources[0] as ContextSource, remote, github],
			backlog: async () => EMPTY_BACKLOG,
		});
		const run = editRun();
		const pushed = {
			...run.result,
			messages: [
				...run.messages,
				{
					id: "p",
					role: "assistant" as const,
					createdAt: 0,
					content: [
						{
							type: "tool-call" as const,
							toolCallId: "p",
							toolName: "run_commands",
							input: { command: "git push" },
						},
					],
				},
			],
		};
		const set = await session.afterRun(pushed);
		expect(set?.candidates.map((row) => row.kind)).toContain("check_ci");
	});

	test("a turn that switched branches gets the new branch's CI evidence and facts", async () => {
		let branch = "main";
		const branches: (string | undefined)[] = [];
		const { session } = harness({
			env: () => ({ ...env, git: { branch, remotes: [] } }),
			dirtyFiles: async () => {
				branch = "feature-b";
				return 2;
			},
			github: (turnEnv) => {
				branches.push(turnEnv.git?.branch);
				return undefined;
			},
			sources: () => [
				...sources,
				{
					id: "branch",
					tier: "T1",
					probe: () => "present",
					facts: (factsEnv) => {
						branches.push(factsEnv.git?.branch);
						return { heading: "Branch", lines: [] };
					},
				},
			],
		});
		await session.afterRun(editRun().result);
		await session.settled();
		expect(branches).toEqual(["feature-b", "feature-b"]);
	});

	test("offer-addressed actions: an action naming the set before a skip resolves against it, and a stale offerId is refused", async () => {
		const { session, labels } = harness();
		const { result, messages } = editRun();
		await session.afterRun(result);
		await session.settled();
		const first = session.current();
		expect(first?.planner).toBe("model");

		const [skippedRow, laterRow] = first?.candidates ?? [];
		const afterSkip = session.invoke({
			type: "skip",
			candidateId: skippedRow?.id ?? "",
			offerId: first?.offerId,
			input: "key",
		}).push.set;
		expect(afterSkip?.candidates.map((row) => row.id)).not.toContain(
			skippedRow?.id,
		);
		session.invoke({
			type: "skip",
			candidateId: laterRow?.id ?? "",
			offerId: first?.offerId,
			input: "key",
		});
		expect(
			labels()
				.filter((r) => r.event === "skip")
				.map((r) => [r.offerId, r.candidateId]),
		).toEqual([
			[first?.offerId, skippedRow?.id],
			[first?.offerId, laterRow?.id],
		]);

		session.invoke({
			type: "unskip",
			candidateId: skippedRow?.id ?? "",
			offerId: afterSkip?.offerId,
		});
		expect(labels().find((r) => r.event === "undo_skip")).toMatchObject({
			candidateId: skippedRow?.id,
		});

		expect(
			session.invoke({
				type: "send",
				candidateId: "anything",
				offerId: "offer_stale_123",
			}).refused,
		).toBe("stale");
		expect(labels().find((r) => r.event === "refused_stale")).toMatchObject({
			reason: "set_changed",
			verb: "do",
		});

		const latest = session.current();
		const usedRow = latest?.candidates[0];
		session.invoke({
			type: "use",
			candidateId: usedRow?.id ?? "",
			offerId: latest?.offerId,
			input: "key",
		});
		session.outgoing([...messages, message("user", `${usedRow?.prompt} now`)]);
		expect(labels().find((r) => r.event === "adjust_sent")).toMatchObject({
			offerId: latest?.offerId,
			candidateId: usedRow?.id,
			bucket: "small",
		});
	});

	test("rerolls run out after the limit, and the tray then says the turn is exhausted", async () => {
		const { session } = harness();
		await session.afterRun(editRun().result);
		await session.settled();
		session.invoke({ type: "reroll", input: "key" });
		await session.settled();
		expect(session.current()?.rerollsLeft).toBe(1);
		session.invoke({ type: "reroll", input: "key" });
		await session.settled();
		expect(session.current()?.rerollsLeft).toBe(0);
		const r3 = session.invoke({ type: "reroll", input: "key" }).push.set;
		expect(r3?.candidates).toEqual([]);
		expect(session.currentPush().state).toBe("exhausted");
	});

	test("a reroll the model's pool cannot answer shows loading until the planner does, and the tray refuses actions meanwhile", async () => {
		const { session, calls } = harness();
		await session.afterRun(editRun().result);
		await session.settled();
		const shown = session.current();
		const pushes: TrayPush[] = [];
		session.onPush((push) => pushes.push(push));
		const { push } = session.invoke({
			type: "reroll",
			offerId: shown?.offerId,
			input: "key",
			cause: "more",
		});
		expect(push).toMatchObject({
			state: "computing",
			computingFor: "reroll",
			rerollsLeft: 1,
		});
		expect(push.set).toBeUndefined();
		expect(
			session.invoke({
				type: "skip",
				candidateId: shown?.candidates[0]?.id ?? "",
				offerId: shown?.offerId,
			}).refused,
		).toBe("stale");
		await session.settled();
		expect(calls).toHaveLength(2);
		expect(pushes.map((entry) => entry.state)).toEqual(["computing", "ready"]);
		expect(session.current()?.offerId).not.toBe(shown?.offerId);
	});

	test("hiding the chat keeps the tray off for later turns, without a planner call", async () => {
		const { session, calls } = harness();
		await session.afterRun(editRun().result);
		await session.settled();
		const callCountBeforeHide = calls.length;
		session.invoke({ type: "hide", scope: "chat" });
		expect(session.currentPush().state).toBe("off");
		await session.afterRun(editRun("Another turn").result);
		await session.settled();
		expect(session.currentPush().state).toBe("off");
		expect(calls.length).toBe(callCountBeforeHide);
	});

	test("a message sent before the deferred serve drops that serve", async () => {
		let slowProbeRelease: () => void = () => undefined;
		const slowGate = new Promise<void>((resolve) => {
			slowProbeRelease = resolve;
		});
		const guarded = harness({
			sources: () => [
				{
					id: "turn",
					tier: "T0",
					probe: async () => {
						await slowGate;
						return "present" as const;
					},
				},
			],
		});
		const firstRun = editRun("Slow probe turn");
		const pendingAfterRun = guarded.session.afterRun(firstRun.result);
		expect(guarded.session.currentPush().state).toBe("computing");
		guarded.session.outgoing([
			...firstRun.messages,
			message("user", "Sent before deferred serve"),
		]);
		expect(guarded.session.currentPush().state).toBe("off");
		slowProbeRelease();
		expect(await pendingAfterRun).toBeUndefined();
		expect(guarded.sets.filter(Boolean)).toEqual([]);
		expect(guarded.session.currentPush().state).toBe("off");
	});

	test("ensureCurrent serves one set on demand from the transcript, with trigger on_demand and no runId", async () => {
		const { messages } = editRun("Forked chat turn");
		const { session, labels, sets } = harness({
			readTranscript: async () => ({
				messages,
				status: "completed",
			}),
		});

		const push = await session.ensureCurrent();
		expect(push).toMatchObject({ state: "computing", computingFor: "turn" });

		await session.settled();
		expect(sets.map((s) => s?.planner)).toEqual(["model"]);
		expect(session.current()?.trigger).toBe("on_demand");
		expect(session.current()?.runId).toBeUndefined();
		const offerRecords = labels().filter((r) => r.event === "offer");
		expect(offerRecords).toHaveLength(1);
		expect(offerRecords[0]?.trigger).toBe("on_demand");
		expect(offerRecords[0]?.runId).toBeUndefined();
	});
});
