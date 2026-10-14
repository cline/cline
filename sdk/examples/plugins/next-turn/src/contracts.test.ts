import { describe, expect, test } from "bun:test";
import { buildManifest } from "./context/manifest";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { suggestion } from "./planner/candidates";
import { buildLabelRecord, offerRecord } from "./planner/labels";
import { NextSession } from "./planner/next";
import { parseTrayAction } from "./planner/tray";
import { defaultSettings } from "./settings/settings";
import {
	contractSchema,
	message,
	runResult,
	schemaErrors,
} from "./test-support";

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

	test("the tray action parser accepts exactly what NextTurnTrayAction accepts", () => {
		const schema = contractSchema("NextTurnTrayAction");
		const accepted = [
			{ type: "current" },
			{ type: "current", client: "cline-desktop", runCount: 2 },
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
		for (const action of accepted) {
			expect([action, parseTrayAction(action)]).toEqual([action, action]);
			expect([action, schemaErrors(schema, action)]).toEqual([action, []]);
		}
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
			{ type: "current", client: "" },
			{ type: "current", runCount: -1 },
			{ type: "current", runCount: 1.5 },
			{ type: "reroll", cause: "two words" },
			{ type: "exposed", candidateId: "" },
			{ type: "hide", scope: "everywhere" },
			{ type: "label", event: "offer" },
			{ type: "label", event: "key_inert", fields: "key" },
		]) {
			expect([refused, parseTrayAction(refused)]).toEqual([refused, null]);
			expect([refused, schemaErrors(schema, refused).length > 0]).toEqual([
				refused,
				true,
			]);
		}
	});
});
