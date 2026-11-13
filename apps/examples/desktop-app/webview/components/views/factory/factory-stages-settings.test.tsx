import { factoryStageCanonicalJson } from "@cline/shared/browser";
import { describe, expect, it } from "vitest";
import {
	factoryStageDefinitionText,
	factoryStageSummary,
} from "./factory-stages-settings";

const stage = {
	id: "no-todo-left",
	name: "No TODO left",
	kind: "command" as const,
	command: '! git diff | grep "TODO\nFIXME"',
	when: { paths: ["src/**"], minSize: "cross_cutting" as const },
	artifacts: ["reports/todo.txt"],
	timeoutSeconds: 120,
};

describe("repository stage rows", () => {
	it("summarises kind, when it runs and whether it blocks delivery", () => {
		expect(factoryStageSummary(stage)).toBe(
			"Command · when src/** changes in a cross-cutting change · blocks delivery",
		);
		expect(
			factoryStageSummary({
				id: "a",
				name: "A",
				kind: "agent",
				access: "write",
				instruction: "x",
				blocking: false,
				when: { minSize: "shared_contract" },
			}),
		).toBe(
			"Agent, can change code before review · on every card in a large change · does not block delivery",
		);
		expect(
			factoryStageSummary({
				id: "b",
				name: "B",
				kind: "agent",
				instruction: "x",
			}),
		).toBe("Agent, read-only · always · blocks delivery");
	});

	it("shows exactly the canonical definition, one key per line", () => {
		const text = factoryStageDefinitionText(stage);
		expect(JSON.parse(text)).toEqual(
			JSON.parse(factoryStageCanonicalJson(stage)),
		);
		expect(text.split("\n")).toHaveLength(
			Object.keys(JSON.parse(factoryStageCanonicalJson(stage))).length + 2,
		);
		expect(text).toContain(
			'  "when": { "paths": [ "src/**" ], "minSize": "cross_cutting" }',
		);
	});
});
