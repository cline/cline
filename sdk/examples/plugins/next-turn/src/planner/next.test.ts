import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextSource, SourceEnv } from "../context/source";
import { defaultSettings, type Settings } from "../settings/settings";
import {
	FileSessionStateStore,
	updateSessionState,
} from "../store/session-state";
import { editRun, message, runResult, useTempDirs } from "../test-support";
import { PlannerLedger, readLedgerTail } from "./allowance";
import { type Backlog, EMPTY_BACKLOG } from "./backlog";
import { LabelLog } from "./labels";
import { type Complete, plannerProvider } from "./model";
import { type NextOptions, NextSession } from "./next";
import type { OfferedSet } from "./tray";
import { deriveTurn } from "./turn";

const sources: ContextSource[] = [
	{ id: "turn", tier: "T0", probe: () => "present" },
	{ id: "git", tier: "T1", probe: () => "present" },
	{ id: "tasks", tier: "T2", probe: () => "present" },
	{ id: "status", tier: "T2", probe: () => "absent" },
	{
		id: "repo",
		tier: "T1",
		probe: () => "present",
		facts: () => ({
			heading: "This repository's commands",
			lines: ["bun run check"],
		}),
	},
];

const env: SourceEnv = {
	client: "cline-cli",
	workspaceRoot: "/w",
	git: { branch: "main", remotes: [] },
	tools: [],
};

const tempDir = useTempDirs("next-turn-session-");

const MODEL_ANSWER =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test src/client.test.ts.","why":"client.ts changed"},{"kind":"wrap_up","source":"turn","prompt":"Summarize the retry change.","why":"done"}]}';

function harness(
	overrides: Partial<NextOptions> = {},
	settings: Settings = defaultSettings(),
) {
	const dir = tempDir();
	const labelsPath = join(dir, "labels.jsonl");
	const calls: string[] = [];
	const complete: Complete = async (input) => {
		calls.push(input.user);
		return { text: MODEL_ANSWER, costUsd: 0.001 };
	};
	const sets: (OfferedSet | undefined)[] = [];
	const backlog: Backlog = {
		...EMPTY_BACKLOG,
		tasks: [
			{
				taskId: "t1",
				title: "Ship the tray",
				status: "approved",
				priority: 2,
				updatedAt: 1,
			},
		],
	};
	const ledgerPath = join(dir, "planner.jsonl");
	const session = new NextSession({
		sessionId: "sess_1",
		settings: () => settings,
		env: () => env,
		sources: () => sources,
		backlog: async () => backlog,
		dirtyFiles: async () => 2,
		complete,
		ledger: new PlannerLedger(ledgerPath),
		labels: new LabelLog(labelsPath),
		...overrides,
	});
	session.onSet((set) => sets.push(set));
	const labels = () =>
		readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	const ledgerCalls = () => readLedgerTail(ledgerPath);
	return { session, sets, calls, labels, ledgerCalls };
}

describe("Next, for one chat", () => {
	test("afterRun serves the rule-based set at once, then the model's when it answers", async () => {
		const { session, sets, calls, labels, ledgerCalls } = harness();
		const { result } = editRun();
		const rules = await session.afterRun(result);
		expect(rules?.planner).toBe("rules");
		expect(rules?.candidates.map((row) => row.prompt)).toEqual([
			"Do the next task: Ship the tray",
			"Run the checks for the files the last turn changed.",
			"Review the changes from the last turn before going on.",
		]);
		await session.settled();
		const model = session.current();
		expect(model?.planner).toBe("model");
		expect(model?.candidates[0]?.prompt).toBe(
			"Run bun test src/client.test.ts.",
		);
		expect(model?.offerId).not.toBe(rules?.offerId);
		expect(sets.map((set) => set?.planner)).toEqual(["rules", "model"]);
		expect(calls[0]).toContain(
			"## This repository's commands\n- bun run check",
		);
		expect(calls[0]).not.toContain("Status Hub");
		const offers = labels().filter((record) => record.event === "offer");
		expect(offers.map((record) => record.planner)).toEqual(["rules", "model"]);
		expect(offers[0]).toMatchObject({
			runId: result.runId,
			turnKey: "sess_1:1",
			kinds: ["continue", "verify", "review_diff"],
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

	test("without a model the rules answer; with the allowance used the set says it is paused", async () => {
		const rulesOnly = harness({ complete: undefined });
		await rulesOnly.session.afterRun(editRun().result);
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
		expect(sets.map((set) => set?.planner ?? "none")).toEqual([
			"rules",
			"none",
		]);
	});

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

	test("a run sent in plan mode drops the Commit row and asks for planning requests until the plan is approved", async () => {
		const systems: string[] = [];
		const { session, labels } = harness({
			sources: () => sources.filter((source) => source.id !== "tasks"),
			backlog: async () => EMPTY_BACKLOG,
			complete: async (input) => {
				systems.push(input.system);
				return { text: MODEL_ANSWER };
			},
		});
		const planned = editRun(
			'<user_input mode="plan">Plan the retry for the client</user_input>',
		);
		const set = await session.afterRun(planned.result);
		await session.settled();
		expect(set?.candidates.map((row) => row.kind)).not.toContain("commit");
		expect(systems[0]).toContain("The chat is in plan mode");
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
		}).set;
		expect(skipped?.candidates.map((row) => row.id)).not.toContain(first?.id);
		expect(skipped?.excluded).toEqual([first?.prompt ?? ""]);
		const rerolled = session.invoke({ type: "reroll" }).set;
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
		expect(session.invoke({ type: "reroll" }).set).toBeUndefined();
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

	test("offer-addressed actions: skipping or using a rules row after the model swap resolves against the rules offer, and a stale offerId is refused", async () => {
		const { session, labels } = harness();
		const { result, messages } = editRun();
		const rules = await session.afterRun(result);
		await session.settled();
		const model = session.current();
		expect(model?.planner).toBe("model");
		expect(
			labels().some(
				(r) =>
					r.event === "superseded" &&
					r.offerId === rules?.offerId &&
					r.cause === "model",
			),
		).toBe(true);

		const rulesRow = rules?.candidates[0];
		expect(rulesRow).toBeDefined();
		const afterSkip = session.invoke({
			type: "skip",
			candidateId: rulesRow?.id ?? "",
			offerId: rules?.offerId,
			input: "key",
		}).set;
		expect(afterSkip?.candidates.map((row) => row.id)).not.toContain(
			rulesRow?.id,
		);
		expect(labels().find((r) => r.event === "skip")).toMatchObject({
			offerId: rules?.offerId,
			candidateId: rulesRow?.id,
		});

		session.invoke({
			type: "unskip",
			candidateId: rulesRow?.id ?? "",
			offerId: afterSkip?.offerId,
		});
		expect(labels().find((r) => r.event === "undo_skip")).toMatchObject({
			candidateId: rulesRow?.id,
		});

		session.invoke({
			type: "send",
			candidateId: "anything",
			offerId: "offer_stale_123",
		});
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
		const r1 = session.invoke({ type: "reroll", input: "key" }).set;
		await session.settled();
		expect(r1?.rerollsLeft).toBe(1);
		const r2 = session.invoke({ type: "reroll", input: "key" }).set;
		await session.settled();
		expect(r2?.rerollsLeft).toBe(0);
		const r3 = session.invoke({ type: "reroll", input: "key" }).set;
		expect(r3?.candidates).toEqual([]);
		expect(session.currentPush().state).toBe("exhausted");
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

	test("ensureCurrent serves a rules set then a model set on demand from the transcript, with trigger on_demand and no runId", async () => {
		const { messages } = editRun("Forked chat turn");
		const { session, labels, sets } = harness({
			readTranscript: async () => ({
				messages,
				status: "completed",
			}),
		});

		const push = await session.ensureCurrent(1);
		expect(push.state).toBe("ready");
		expect(push.set?.planner).toBe("rules");
		expect(push.set?.trigger).toBe("on_demand");
		expect(push.set?.runId).toBeUndefined();

		await session.settled();
		expect(sets.map((s) => s?.planner)).toEqual(["rules", "model"]);
		const offerRecords = labels().filter((r) => r.event === "offer");
		expect(offerRecords).toHaveLength(2);
		expect(offerRecords[0]?.trigger).toBe("on_demand");
		expect(offerRecords[0]?.runId).toBeUndefined();
		expect(offerRecords[1]?.trigger).toBe("on_demand");
	});
});

describe("Next under overlapping actions", () => {
	test("hiding the chat while a set is computing keeps the tray off", async () => {
		const { session, sets } = harness();
		const served = session.afterRun(editRun().result);
		session.invoke({ type: "hide", scope: "chat" });
		expect(await served).toBeUndefined();
		await session.settled();
		expect(sets.filter(Boolean)).toEqual([]);
		expect(session.current()).toBeUndefined();
		expect(session.currentPush().state).toBe("off");
	});

	test("a turn that ends while the planner is still answering the last one stays within the allowance", async () => {
		const settings = defaultSettings();
		settings.planner.callsPerHour = 1;
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		let dispatched: () => void = () => {};
		const asking = new Promise<void>((resolve) => {
			dispatched = resolve;
		});
		let asked = 0;
		const { session, ledgerCalls } = harness(
			{
				complete: async () => {
					asked += 1;
					dispatched();
					await answered;
					return { text: MODEL_ANSWER, costUsd: 0.001 };
				},
			},
			settings,
		);
		await session.afterRun(editRun().result);
		await asking;
		const second = await session.afterRun(editRun("And now a timeout").result);
		release();
		await session.settled();
		expect(asked).toBe(1);
		expect(second?.paused?.resetsAt).toBeGreaterThan(0);
		expect(ledgerCalls()).toHaveLength(1);
	});

	test("a reroll after the planner moves to another provider leaves other chats out", async () => {
		const settings = defaultSettings();
		const history: ContextSource = {
			id: "history",
			tier: "T2",
			settingsToggle: "history",
			readsOtherChats: true,
			probe: () => "present",
			facts: () => ({
				heading: "Related chats in this workspace",
				lines: ['"Secret payroll migration" · 2h ago · idle'],
			}),
		};
		const sent: { providerId?: string; user: string }[] = [];
		const { session } = harness(
			{
				sources: () => [...sources, history],
				complete: async (input, _signal, planned) => {
					sent.push({
						providerId: plannerProvider(planned, session.chat()).providerId,
						user: input.user,
					});
					return { text: MODEL_ANSWER };
				},
			},
			settings,
		);
		const ask = message("user", "Add a retry to the client");
		const reply = message("assistant", "Added the retry.", {
			modelInfo: { provider: "anthropic", id: "claude" },
		});
		await session.afterRun(runResult([ask, reply]));
		await session.settled();
		expect(sent[0]?.providerId).toBe("anthropic");
		expect(sent[0]?.user).toContain("Secret payroll migration");
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "gpt",
		};
		session.invoke({ type: "reroll" });
		await session.settled();
		expect(sent[1]?.providerId).toBe("openai");
		expect(sent[1]?.user).not.toContain("Secret payroll migration");
	});

	test("a reroll after a script is removed no longer names it to the planner", async () => {
		let scripts = ["script:test", "script:lint"];
		const repo: ContextSource = {
			id: "repo-scripts",
			tier: "T0",
			probe: () => "present",
			capabilities: () => scripts,
		};
		const sent: string[] = [];
		const { session } = harness({
			sources: () => [...sources, repo],
			complete: async (input) => {
				sent.push(input.user);
				return { text: MODEL_ANSWER };
			},
		});
		await session.afterRun(editRun().result);
		await session.settled();
		expect(sent[0]).toContain("script:lint");
		scripts = ["script:test"];
		session.invoke({ type: "reroll" });
		await session.settled();
		expect(sent[1]).toContain("script:test");
		expect(sent[1]).not.toContain("script:lint");
	});

	test("a model set is tagged with the manifest its planner call saw", async () => {
		const settings = defaultSettings();
		const history: ContextSource = {
			id: "history",
			tier: "T2",
			settingsToggle: "history",
			readsOtherChats: true,
			probe: () => "present",
			facts: () => ({
				heading: "Related chats in this workspace",
				lines: ['"Secret payroll migration" · 2h ago · idle'],
			}),
		};
		const { session, labels } = harness(
			{ sources: () => [...sources, history] },
			settings,
		);
		const ask = message("user", "Add a retry to the client");
		const reply = message("assistant", "Added the retry.", {
			modelInfo: { provider: "anthropic", id: "claude" },
		});
		await session.afterRun(runResult([ask, reply]));
		await session.settled();
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "gpt",
		};
		session.invoke({ type: "reroll" });
		await session.settled();
		const tags = labels()
			.filter((record) => record.event === "offer")
			.map((record) => record.tags);
		expect(tags[0]).toContain("source:history:present");
		expect(tags.at(-1)).toContain("source:history:off");
		expect(tags.at(-1)).not.toContain("source:history:present");
	});

	test("a reroll right after a respawn keeps the capabilities the turn saved while its sources load", async () => {
		const store = new FileSessionStateStore(
			tempDir("respawn-capabilities-"),
			"sess_1",
		);
		let loaded = true;
		const linear: ContextSource = {
			id: "pinned-linear",
			tier: "T0",
			probe: () => "present",
			capabilities: () => (loaded ? ["mcp:linear"] : []),
		};
		const first = harness({ store, sources: () => [...sources, linear] });
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(first.calls[0]).toContain("mcp:linear");
		loaded = false;
		const respawned = harness({ store, sources: () => [...sources, linear] });
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(respawned.calls[0]).toContain("mcp:linear");
	});

	test("a reroll while the planner is still answering asks the model once", async () => {
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		let asked = 0;
		const complete: Complete = async () => {
			asked += 1;
			await answered;
			return { text: MODEL_ANSWER, costUsd: 0.001 };
		};
		const { session, ledgerCalls } = harness({ complete });
		await session.afterRun(editRun().result);
		session.invoke({ type: "reroll" });
		release();
		await session.settled();
		expect(asked).toBe(1);
		expect(ledgerCalls()).toHaveLength(1);
	});

	test("an off push takes the next number in the session's own sequence, once", async () => {
		const { session } = harness({ complete: undefined });
		await session.afterRun(editRun().result);
		const before = session.currentPush().seq;
		const off = session.off();
		expect(off).toMatchObject({ seq: before + 1, state: "off" });
		expect(session.off()).toBe(off);
		expect(session.currentPush()).toBe(off);
	});

	test("a viewer that asks for the set after Next was turned off gets a newer off push, and the set is dropped", async () => {
		const settings = defaultSettings();
		const { session } = harness({ complete: undefined }, settings);
		await session.afterRun(editRun().result);
		const ready = session.currentPush();
		expect(ready.state).toBe("ready");
		settings.features.next = false;
		const reply = await session.ensureCurrent();
		expect(reply).toMatchObject({ state: "off", seq: ready.seq + 1 });
		expect(session.current()).toBeUndefined();
		expect(await session.ensureCurrent()).toBe(reply);
	});

	test("turning off drops the set and the planner's late answer, so turning back on serves the turn again", async () => {
		let release: () => void = () => {};
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		const complete: Complete = async () => {
			await answered;
			return { text: MODEL_ANSWER, costUsd: 0.001 };
		};
		const { session, sets } = harness({ complete });
		await session.afterRun(editRun().result);
		const off = session.off();
		release();
		await session.settled();
		expect(sets.at(-1)).toBeUndefined();
		expect(session.currentPush().state).toBe("off");
		const reply = await session.ensureCurrent(session.turn()?.runCount);
		expect(reply.state).toBe("ready");
		expect(reply.seq).toBeGreaterThan(off.seq);
	});

	test("asking for the current set while the turn is still being served waits for that serve", async () => {
		const { session, labels } = harness({ complete: undefined });
		const states: string[] = [];
		session.onPush((push) => states.push(push.state));
		const served = session.afterRun(editRun().result);
		const reply = await session.ensureCurrent(session.turn()?.runCount);
		await served;
		expect(reply.state).toBe("ready");
		expect(states).toEqual(["computing", "ready"]);
		expect(
			labels()
				.filter((record) => record.event === "offer")
				.map((record) => record.trigger),
		).toEqual(["after_run"]);
	});

	test("hiding the chat while a viewer's set is read from the transcript keeps the tray off", async () => {
		let release: () => void = () => {};
		const read = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { messages } = editRun("Forked chat turn");
		const { session } = harness({
			complete: undefined,
			readTranscript: async () => {
				await read;
				return { messages, status: "completed" };
			},
		});
		const reply = session.ensureCurrent(1);
		session.invoke({ type: "hide", scope: "chat" });
		release();
		expect((await reply).state).toBe("off");
		expect(session.current()).toBeUndefined();
	});

	test("a viewer that opens a chat while its run is still going gets no set until the run ends", async () => {
		const { messages } = editRun("Fix the parser");
		const opened = harness({
			readTranscript: async () => ({ messages, status: "running" }),
		});
		expect((await opened.session.ensureCurrent(1)).state).toBe("off");
		await opened.session.settled();
		expect(opened.calls).toEqual([]);
		expect(opened.sets.filter(Boolean)).toEqual([]);

		const live = harness({ complete: undefined });
		const first = editRun();
		await live.session.afterRun(first.result);
		live.session.outgoing([
			...first.messages,
			message("user", "Now the parser"),
		]);
		expect((await live.session.ensureCurrent()).state).toBe("off");
		expect(live.session.current()).toBeUndefined();
	});

	test("a Next that starts while the chat's next run is going (a dormant chat's viewer, a respawn) serves nothing from the turn before it", async () => {
		const first = editRun("Fix the parser");
		const storeWithFirstTurn = (label: string) => {
			const store = new FileSessionStateStore(tempDir(label), "sess_1");
			updateSessionState(store, {
				lastTurn: deriveTurn("sess_1", first.result) ?? undefined,
			});
			return store;
		};
		const secondRun = [
			...first.messages,
			message("assistant", "Fixed."),
			message("user", "Now the lexer"),
		];
		let transcript = { messages: secondRun, status: "running" };
		const started = harness({
			store: storeWithFirstTurn("mid-run-"),
			readTranscript: async () => transcript,
		});
		expect((await started.session.ensureCurrent()).state).toBe("off");
		await started.session.settled();
		expect(started.calls).toEqual([]);
		expect(started.ledgerCalls()).toEqual([]);
		expect(started.sets.filter(Boolean)).toEqual([]);

		transcript = {
			messages: [...secondRun, message("assistant", "Done.")],
			status: "idle",
		};
		expect(await started.session.ensureCurrent()).toMatchObject({
			state: "ready",
			set: { runCount: 2, trigger: "on_demand" },
		});

		const caughtUp = harness({
			store: storeWithFirstTurn("caught-up-"),
			readTranscript: async () => ({
				messages: first.messages,
				status: "idle",
			}),
		});
		expect(await caughtUp.session.ensureCurrent()).toMatchObject({
			state: "ready",
			set: { runCount: 1, runId: first.result.runId },
		});
	});

	test("a tray action that lands while the next turn is computing is refused, not applied to the previous set", async () => {
		const { session, labels } = harness({ complete: undefined });
		const first = await session.afterRun(editRun().result);
		const served = session.afterRun(editRun("Second turn").result);
		const reply = session.invoke({
			type: "skip",
			candidateId: first?.candidates[0]?.id ?? "",
		});
		expect(reply.state).toBe("computing");
		expect(labels().find((r) => r.event === "refused_stale")).toMatchObject({
			reason: "computing",
			offerId: first?.offerId,
		});
		expect(labels().some((r) => r.event === "skip")).toBe(false);
		expect((await served)?.offerId).not.toBe(first?.offerId);
		expect(session.currentPush().state).toBe("ready");
	});

	test("a serve that fails leaves the tray unavailable, and a viewer's current gets that push", async () => {
		const failing = async (): Promise<Backlog> => {
			throw new Error("backlog unreadable");
		};
		const { session } = harness({ complete: undefined, backlog: failing });
		expect(await session.afterRun(editRun().result)).toBeUndefined();
		expect(session.currentPush()).toMatchObject({
			state: "unavailable",
			error: "backlog unreadable",
		});
		const { messages } = editRun("Forked chat turn");
		const viewed = harness({
			complete: undefined,
			backlog: failing,
			readTranscript: async () => ({ messages, status: "completed" }),
		});
		expect((await viewed.session.ensureCurrent(1)).state).toBe("unavailable");
	});

	test("when the planner fails, the set on screen keeps its tray state and reports the error", async () => {
		let asked = 0;
		const { session, sets } = harness({
			complete: async () => {
				asked += 1;
				return { text: "not json" };
			},
			dirtyFiles: undefined,
		});
		await session.afterRun(editRun().result);
		await session.settled();
		expect(session.currentPush()).toMatchObject({
			state: "ready",
			set: { model: { status: "error" } },
		});
		expect(sets).toHaveLength(1);
		session.invoke({ type: "reroll" });
		session.invoke({ type: "reroll" });
		expect(session.currentPush().state).toBe("exhausted");
		await session.settled();
		expect(asked).toBe(2);
		expect(session.currentPush()).toMatchObject({
			state: "exhausted",
			set: { candidates: [], model: { status: "error" } },
		});
		expect(sets).toHaveLength(3);
	});

	test("a session rebuilt after a respawn keeps its manifest and trigger, and reads the backlog again before asking the planner", async () => {
		const store = new FileSessionStateStore(tempDir("respawn-"), "sess_1");
		let backlogReads = 0;
		const backlog = async (): Promise<Backlog> => {
			backlogReads += 1;
			return {
				...EMPTY_BACKLOG,
				tasks: [
					{
						taskId: "t1",
						title: "Ship the tray",
						status: "approved",
						priority: 2,
						updatedAt: 1,
					},
				],
			};
		};
		const first = harness({ store, backlog });
		await first.session.afterRun(editRun().result);
		await first.session.settled();
		expect(first.session.current()?.planner).toBe("model");
		const respawned = harness({ store, backlog });
		respawned.session.invoke({ type: "reroll" });
		await respawned.session.settled();
		expect(backlogReads).toBe(2);
		expect(respawned.calls).toHaveLength(1);
		expect(respawned.calls[0]).toContain("Ship the tray");
		const offers = respawned
			.labels()
			.filter((record) => record.event === "offer");
		expect(offers.length).toBeGreaterThan(0);
		for (const offer of offers) {
			expect(offer.trigger).toBe("after_run");
			expect(offer.tags).toEqual(
				expect.arrayContaining(["source:tasks:present"]),
			);
		}
	});

	test("a Use made before a respawn labels the edited message against the row it used", async () => {
		const store = new FileSessionStateStore(tempDir("intent-"), "sess_1");
		const first = harness({ store, complete: undefined });
		const { result, messages } = editRun();
		const set = await first.session.afterRun(result);
		const used = set?.candidates[0];
		first.session.invoke({
			type: "use",
			candidateId: used?.id ?? "",
			offerId: set?.offerId,
			input: "key",
		});
		const respawned = harness({ store, complete: undefined });
		respawned.session.outgoing([
			...messages,
			message("user", `${used?.prompt} now`),
		]);
		expect(respawned.labels().map((record) => record.event)).toEqual([
			"adjust_sent",
			"superseded",
		]);
		expect(respawned.labels()[0]).toMatchObject({
			offerId: set?.offerId,
			candidateId: used?.id,
			input: "key",
		});
	});

	test("a disposed session installs no set from a serve already under way", async () => {
		const { session } = harness({ complete: undefined });
		const served = session.afterRun(editRun().result);
		session.dispose();
		expect(await served).toBeUndefined();
		expect(session.current()).toBeUndefined();
	});

	test("hiding the chat while the tray is already off still holds after a respawn", async () => {
		const dir = tempDir("hide-");
		const first = harness({
			store: new FileSessionStateStore(dir, "sess_1"),
			complete: undefined,
		});
		first.session.off();
		first.session.invoke({ type: "hide", scope: "chat" });
		const respawned = harness({
			store: new FileSessionStateStore(dir, "sess_1"),
			complete: undefined,
		});
		await respawned.session.afterRun(editRun().result);
		await respawned.session.settled();
		expect(respawned.sets.filter(Boolean)).toEqual([]);
		expect(respawned.session.currentPush().state).toBe("off");
	});

	test("a saved turn that does not restore leaves the session without a set instead of failing", () => {
		const store = new FileSessionStateStore(tempDir("malformed-"), "sess_1");
		store.write({ seq: 4, turnState: { excludedIds: 7 } as never });
		const { session } = harness({ store, complete: undefined });
		expect(session.current()).toBeUndefined();
		expect(session.currentPush()).toMatchObject({ seq: 4, state: "off" });
	});
});
