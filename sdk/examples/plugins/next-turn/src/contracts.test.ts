import { describe, expect, test } from "bun:test";
import { buildManifest } from "./context/manifest";
import { NEXT_TURN_SCHEMAS } from "./contracts";
import { EMPTY_BACKLOG } from "./planner/backlog";
import { suggestion } from "./planner/candidates";
import { buildLabelRecord, offerRecord } from "./planner/labels";
import { NextSession } from "./planner/next";
import { defaultSettings } from "./settings/settings";

type ObjectSchema = {
	required?: string[];
	properties: Record<
		string,
		{ enum?: unknown[]; items?: ObjectSchema; const?: unknown }
	>;
};

function schema(name: string): ObjectSchema {
	const entry = NEXT_TURN_SCHEMAS.find((candidate) => candidate.name === name);
	if (!entry) throw new Error(`no schema ${name}`);
	return entry.schema as ObjectSchema;
}

/** Every key is one the schema names, every required key is there, and enum fields hold allowed values. */
function conforms(value: Record<string, unknown>, shape: ObjectSchema): void {
	for (const key of shape.required ?? [])
		expect([key, key in value]).toEqual([key, true]);
	for (const [key, field] of Object.entries(value)) {
		const property = shape.properties[key];
		expect([key, property !== undefined]).toEqual([key, true]);
		if (property?.enum) expect(property.enum).toContain(field);
		if (property?.items?.properties && Array.isArray(field))
			for (const item of field)
				conforms(item as Record<string, unknown>, property.items);
	}
}

describe("what Next Turn publishes as JSON Schema", () => {
	test("an offer record, a served set, a tray push and a manifest stay inside their schemas", async () => {
		const session = new NextSession({
			sessionId: "sess_1",
			settings: defaultSettings,
			env: () => ({ client: "cline-cli", tools: [] }),
			sources: () => [{ id: "turn", tier: "T0", probe: () => "present" }],
			backlog: async () => EMPTY_BACKLOG,
		});
		const set = await session.afterRun({
			agentId: "a",
			runId: "run_1",
			status: "completed",
			iterations: 1,
			outputText: "ok",
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "Go" }],
					createdAt: 1,
				},
			],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
		expect(set).toBeDefined();
		if (!set) return;
		conforms(set as unknown as Record<string, unknown>, schema("NextTurnSet"));
		conforms(
			session.currentPush() as unknown as Record<string, unknown>,
			schema("NextTurnTrayPush"),
		);
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
							{ outward: true },
						),
					],
				},
				{
					turn: { status: "completed", filesEdited: 0, toolErrored: false },
					latencyMs: 1,
					fallback: false,
					tags: ["cap:slack"],
				},
			),
		);
		conforms(record, schema("NextTurnLabelRecord"));
		conforms(
			(await buildManifest([], {
				client: "cline-cli",
				tools: [],
				mode: "act",
			})) as unknown as Record<string, unknown>,
			schema("NextTurnManifest"),
		);
	});

	test("each schema says what it is and which way it flows", () => {
		expect(NEXT_TURN_SCHEMAS.map((entry) => [entry.name, entry.io])).toEqual([
			["NextTurnLabelRecord", "output"],
			["NextTurnManifest", "output"],
			["NextTurnSet", "output"],
			["NextTurnTrayPush", "output"],
			["NextTurnTrayAction", "input"],
		]);
	});
});
