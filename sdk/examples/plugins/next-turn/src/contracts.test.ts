import { describe, expect, test } from "bun:test";
import { buildManifest } from "./context/manifest";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { suggestion } from "./planner/candidates";
import { buildLabelRecord, offerRecord } from "./planner/labels/labels";
import { NextSession } from "./planner/session/session";
import { defaultSettings } from "./settings/settings";
import { message, runResult } from "./test-support/agent-runs";
import { contractSchema, schemaErrors } from "./test-support/schema";

function contractErrors(name: string, value: unknown): string[] {
	return schemaErrors(contractSchema(name), value);
}

describe("what Next Turn publishes as JSON Schema", () => {
	test("an offer record, a served set, a tray push and a manifest stay inside their schemas", async () => {
		const messages = [message("user", "Go")];
		const session = () =>
			new NextSession({
				sessionId: "sess_1",
				settings: defaultSettings,
				env: () => ({ client: "cline-cli", tools: [] }),
				sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
				backlog: async () => EMPTY_BACKLOG,
				readTranscript: async () => ({ messages, status: "completed" }),
			});
		const afterRun = session();
		const set = await afterRun.afterRun(runResult(messages));
		expect(set).toBeDefined();
		expect(contractErrors("NextTurnSet", set)).toEqual([]);
		expect(contractErrors("NextTurnTrayPush", afterRun.currentPush())).toEqual(
			[],
		);
		const onDemand = (await session().ensureCurrent()).set;
		expect(onDemand).toMatchObject({ trigger: "on_demand" });
		expect(onDemand?.runId).toBeUndefined();
		expect(contractErrors("NextTurnSet", onDemand)).toEqual([]);
		if (!set) return;
		const record = buildLabelRecord(
			offerRecord(
				{
					...set,
					candidates: [
						suggestion(
							"post_update",
							"connector",
							"Post the release note to the team.",
							"Slack is connected",
						),
					],
				},
				{
					turn: { status: "completed", filesEdited: 0, toolErrored: false },
					latencyMs: 1,
					tags: ["cap:slack"],
				},
			),
		);
		expect(contractErrors("NextTurnLabelRecord", record)).toEqual([]);
		expect(
			contractErrors(
				"NextTurnManifest",
				await buildManifest([], {
					client: "cline-cli",
					tools: [],
					mode: "act",
				}),
			),
		).toEqual([]);
	});

	test("rule rows built from a long task title, status headline and failing check list stay inside their schemas", async () => {
		const session = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: () => ({ client: "cline-cli", tools: [] }),
			sources: () => [
				{ id: "turn", tier: "T0", probe: () => "present" },
				{ id: "status", tier: "T2", probe: () => "present" },
				{ id: "tasks", tier: "T2", probe: () => "present" },
				{
					id: "github",
					tier: "T3",
					probe: () => "present",
					capabilities: () => ["github", "remote:github"],
				},
			],
			backlog: async () => ({
				...EMPTY_BACKLOG,
				statusRows: [
					{
						subject: "migration/auth",
						state: "blocked",
						headline: "a".repeat(110),
					},
				],
				tasks: [
					{
						taskId: "t1",
						title: "b".repeat(200),
						status: "approved",
						priority: 2,
						updatedAt: 1,
					},
				],
			}),
			github: () => ({
				failingChecks: Array.from(
					{ length: 6 },
					(_, index) => `build (ubuntu-latest, node ${20 + index})`,
				),
			}),
		});
		const set = await session.afterRun(runResult([message("user", "Go")]));
		expect(set?.candidates.map((row) => row.source)).toEqual([
			"status",
			"tasks",
			"connector",
		]);
		expect(contractErrors("NextTurnSet", set)).toEqual([]);
		expect(contractErrors("NextTurnTrayPush", session.currentPush())).toEqual(
			[],
		);
	});

	test("a tray push says why the tray is off and what a computing push is for, and names nothing else", () => {
		const base = { sessionId: "sess_1", seq: 3 };
		for (const push of [
			{ ...base, state: "off", offReason: "message" },
			{ ...base, state: "off", offReason: "hidden" },
			{ ...base, state: "off", offReason: "disabled" },
			{ ...base, state: "computing", computingFor: "turn" },
			{ ...base, state: "computing", computingFor: "reroll" },
		])
			expect([push, contractErrors("NextTurnTrayPush", push)]).toEqual([
				push,
				[],
			]);
		for (const push of [
			{ ...base, state: "off", offReason: "bored" },
			{ ...base, state: "computing", computingFor: "lunch" },
			{ ...base, state: "off", hiddenReason: "user" },
		])
			expect([
				push,
				contractErrors("NextTurnTrayPush", push).length > 0,
			]).toEqual([push, true]);
	});

	test("NextTurnTrayAction accepts every tray action and refuses malformed ones", () => {
		const schema = contractSchema("NextTurnTrayAction");
		const accepted = [
			{
				type: "skip",
				candidateId: "c1",
				offerId: "o1",
				input: "click",
				msSinceExposed: 5,
			},
			{ type: "unskip", candidateId: "c1", offerId: "o1", input: "key" },
			{ type: "use", candidateId: "c1", input: "key", msSinceExposed: 0 },
			{ type: "send", candidateId: "c1" },
			{ type: "reroll" },
			{ type: "reroll", offerId: "o1", input: "key", cause: "button" },
			{ type: "exposed", offerId: "o1", candidateId: "c1" },
			{ type: "hide" },
			{ type: "hide", scope: "chat" },
			{
				type: "label",
				event: "key_inert",
				offerId: "o1",
				fields: { key: "cmd_2" },
			},
		];
		for (const action of accepted)
			expect([action, schemaErrors(schema, action)]).toEqual([action, []]);
		const branchTypes = (
			schema.oneOf as { properties: { type: { const: string } } }[]
		).map((branch) => branch.properties.type.const);
		expect([...new Set(accepted.map((action) => action.type))]).toEqual(
			branchTypes,
		);
		for (const refused of [
			"skip",
			{ type: "unknown_verb" },
			{ type: "toString" },
			{ type: "skip" },
			{ type: "skip", candidateId: "" },
			{ type: "skip", candidateId: "c1", offerId: "" },
			{ type: "skip", candidateId: "c1", extra: true },
			{ type: "skip", candidateId: "c1", input: "not a token!" },
			{ type: "unskip", candidateId: "c1", msSinceExposed: 5 },
			{ type: "current" },
			{ type: "reroll", cause: "two words" },
			{ type: "exposed", candidateId: "" },
			{ type: "hide", scope: "everywhere" },
			{ type: "label", event: "offer" },
			{ type: "label", event: "key_inert", fields: "key" },
		])
			expect([refused, schemaErrors(schema, refused).length > 0]).toEqual([
				refused,
				true,
			]);
	});
});
