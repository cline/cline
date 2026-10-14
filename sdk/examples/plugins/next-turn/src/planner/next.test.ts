import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import type { ContextSource, SourceEnv } from "../context/source";
import { NEXT_TURN_SCHEMAS } from "../contracts";
import { PlannerLedger } from "../engine/allowance";
import { createNextTurnPlugin } from "../plugin";
import { defaultSettings, type Settings } from "../settings/settings";
import { type Backlog, EMPTY_BACKLOG } from "./backlog";
import { LabelLog } from "./labels";
import type { Complete } from "./model";
import { type NextOptions, NextSession, type OfferedSet } from "./next";

let ids = 0;
function message(role: AgentMessage["role"], text: string): AgentMessage {
	ids += 1;
	return {
		id: `m${ids}`,
		role,
		content: [{ type: "text", text }],
		createdAt: ids,
	};
}

function editRun(request = "Add a retry to the client"): {
	result: AgentRunResult;
	messages: AgentMessage[];
} {
	ids += 1;
	const messages: AgentMessage[] = [
		message("user", request),
		{
			id: `m${ids}`,
			role: "assistant",
			createdAt: ids,
			content: [
				{
					type: "tool-call",
					toolCallId: `c${ids}`,
					toolName: "editor",
					input: { path: "src/client.ts" },
				},
			],
		},
	];
	return {
		messages,
		result: {
			agentId: "a",
			runId: `run_${ids}`,
			status: "completed",
			iterations: 1,
			outputText: "Added the retry.",
			messages,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
	};
}

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

const MODEL_ANSWER =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run bun test src/client.test.ts.","why":"client.ts changed"},{"kind":"wrap_up","source":"turn","prompt":"Summarize the retry change.","why":"done"}]}';

function harness(
	overrides: Partial<NextOptions> = {},
	settings: Settings = defaultSettings(),
) {
	const dir = mkdtempSync(join(tmpdir(), "next-turn-session-"));
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
	const ledger = new PlannerLedger(join(dir, "planner.jsonl"));
	const session = new NextSession({
		sessionId: "sess_1",
		settings: () => settings,
		env: () => env,
		sources: () => sources,
		backlog: async () => backlog,
		dirtyFiles: async () => 2,
		complete,
		ledger,
		labels: new LabelLog(labelsPath),
		...overrides,
	});
	session.onSet((set) => sets.push(set));
	const labels = () =>
		readFileSync(labelsPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	return { session, sets, calls, labels, ledger };
}

describe("Next, for one chat", () => {
	test("afterRun serves the rule-based set at once, then the model's when it answers", async () => {
		const { session, sets, calls, labels, ledger } = harness();
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
		expect(ledger.calls()).toHaveLength(1);
		expect(ledger.calls()[0]?.costUsd).toBe(0.001);
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
			message("user", "Deploy it to staging"),
		]);
		expect(typed.labels()[1]).toMatchObject({
			event: "typed_instead",
			chars: "Deploy it to staging".length,
		});
		expect(JSON.stringify(typed.labels())).not.toContain("staging");
	});

	test("skip and reroll serve new sets from the same turn; hide clears the tray", async () => {
		const { session, labels } = harness({ complete: undefined });
		const set = await session.afterRun(editRun().result);
		const first = set?.candidates[0];
		const skipped = await session.invoke({
			type: "skip",
			candidateId: first?.id ?? "",
		});
		expect(skipped?.candidates.map((row) => row.id)).not.toContain(first?.id);
		expect(skipped?.excluded).toEqual([first?.prompt ?? ""]);
		const rerolled = await session.invoke({ type: "reroll" });
		expect(
			rerolled?.candidates.some((row) =>
				skipped?.candidates.some((old) => old.id === row.id),
			),
		).toBe(false);
		await session.invoke({ type: "exposed" });
		await session.invoke({ type: "hide" });
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
		expect(await session.invoke({ type: "reroll" })).toBeUndefined();
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
		const afterSkip = await session.invoke({
			type: "skip",
			candidateId: rulesRow?.id ?? "",
			offerId: rules?.offerId,
			input: "key",
		});
		expect(afterSkip?.candidates.map((row) => row.id)).not.toContain(
			rulesRow?.id,
		);
		expect(labels().find((r) => r.event === "skip")).toMatchObject({
			offerId: rules?.offerId,
			candidateId: rulesRow?.id,
		});

		await session.invoke({
			type: "unskip",
			candidateId: rulesRow?.id ?? "",
			offerId: afterSkip?.offerId,
		});
		expect(labels().find((r) => r.event === "undo_skip")).toMatchObject({
			candidateId: rulesRow?.id,
		});

		await session.invoke({
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
		await session.invoke({
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

	test("reroll limit, hide{scope:'chat'}, label passthrough, and generation guard before deferred serve", async () => {
		const { session, labels, calls } = harness();
		const { result } = editRun();
		await session.afterRun(result);
		await session.settled();

		const r1 = await session.invoke({ type: "reroll", input: "key" });
		await session.settled();
		expect(r1?.rerollsLeft).toBe(1);
		const r2 = await session.invoke({ type: "reroll", input: "key" });
		await session.settled();
		expect(r2?.rerollsLeft).toBe(0);
		const r3 = await session.invoke({ type: "reroll", input: "key" });
		expect(r3?.candidates).toEqual([]);
		expect(session.currentPush().state).toBe("exhausted");

		await session.invoke({
			type: "label",
			event: "key_inert",
			fields: { key: "cmd_2", reason: "exhausted" },
		});
		expect(labels().find((r) => r.event === "key_inert")).toMatchObject({
			key: "cmd_2",
			reason: "exhausted",
		});

		const callCountBeforeHide = calls.length;
		await session.invoke({ type: "hide", scope: "chat" });
		expect(session.currentPush().state).toBe("off");
		await session.afterRun(editRun("Another turn").result);
		await session.settled();
		expect(session.currentPush().state).toBe("off");
		expect(calls.length).toBe(callCountBeforeHide);

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
		slowProbeRelease();
		expect(await pendingAfterRun).toBeUndefined();
		expect(guarded.sets).toEqual([]);
	});

	test("ensureCurrent serves a rules set then a model set on demand from the transcript, with trigger on_demand and no runId, and a session never viewed stays silent across five turns", async () => {
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

		const setSchema = NEXT_TURN_SCHEMAS.find((s) => s.name === "NextTurnSet")
			?.schema as {
			required?: string[];
			properties: Record<string, { enum?: unknown[] }>;
		};
		for (const reqKey of setSchema.required ?? []) {
			expect(reqKey in (push.set ?? {})).toBe(true);
		}
		for (const [k, v] of Object.entries(push.set ?? {})) {
			expect(setSchema.properties[k]).toBeDefined();
			if (setSchema.properties[k]?.enum)
				expect(setSchema.properties[k].enum).toContain(v);
		}

		await session.settled();
		expect(sets.map((s) => s?.planner)).toEqual(["rules", "model"]);
		const offerRecords = labels().filter((r) => r.event === "offer");
		expect(offerRecords).toHaveLength(2);
		expect(offerRecords[0]?.trigger).toBe("on_demand");
		expect(offerRecords[0]?.runId).toBeUndefined();
		expect(offerRecords[1]?.trigger).toBe("on_demand");

		let dormantRecorded = 0;
		const dormantRuntime = {
			engine: undefined as never,
			next: undefined,
			activateNext: () => undefined as never,
			recordDormantTurn: () => {
				dormantRecorded += 1;
			},
			setTools: () => undefined,
			stop: () => undefined,
		};
		const plugin = createNextTurnPlugin({
			startRuntime: () => dormantRuntime,
			isNextActive: () => false,
		});
		await plugin.setup?.(
			{
				registerUiHandler: () => undefined,
			} as never,
			{
				session: { sessionId: "sess_dormant_5" },
				client: { name: "cline-cli" },
				workspaceInfo: { rootPath: "/w" },
			} as never,
		);
		for (let i = 1; i <= 5; i += 1) {
			await plugin.hooks?.afterRun?.({
				result: editRun(`Silent turn ${i}`).result,
				snapshot: {},
			} as never);
		}
		expect(dormantRuntime.next).toBeUndefined();
		expect(dormantRecorded).toBe(5);

		let hubCalls = 0;
		const freshNext = harness({
			readTranscript: async () => {
				hubCalls += 2;
				return { messages, status: "completed" };
			},
		}).session;
		const onDemandFromHub = {
			engine: undefined as never,
			next: freshNext,
			setTools: () => undefined,
			stop: () => undefined,
		};
		let freshHandler:
			| ((input: unknown) => Promise<unknown> | unknown)
			| undefined;
		const freshPlugin = createNextTurnPlugin({
			startRuntime: () => onDemandFromHub,
			isNextActive: () => true,
		});
		await freshPlugin.setup?.(
			{
				registerUiHandler(
					name: string,
					fn: (input: unknown) => Promise<unknown> | unknown,
				) {
					if (name === "next") freshHandler = fn;
				},
			} as never,
			{
				session: { sessionId: "sess_fresh_hub" },
				client: { name: "cline-desktop" },
				workspaceInfo: { rootPath: "/w" },
			} as never,
		);
		const freshPush = (await freshHandler?.({
			type: "current",
			runCount: 1,
		})) as { state: string; set?: OfferedSet };
		expect(freshPush.state).toBe("ready");
		expect(freshPush.set?.trigger).toBe("on_demand");
		expect(freshPush.set?.runId).toBeUndefined();
		expect(hubCalls).toBe(2);
	});
});
