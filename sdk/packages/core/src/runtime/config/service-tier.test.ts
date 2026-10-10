import { AgentConfigSchema } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { readSessionConnectionUpdate } from "../../hub/server/handlers/session-handlers";
import { buildModelOptions } from "./agent-runtime-config-builder";
import {
	buildConnectionUpdate,
	normalizeConnectionUpdate,
} from "./connection-update";

describe("service tier", () => {
	it("allows priority and null clearing without implicitly enabling reasoning", () => {
		for (const serviceTier of ["priority", null] as const) {
			expect(buildConnectionUpdate({ serviceTier })).toEqual({ serviceTier });
			expect(readSessionConnectionUpdate({ serviceTier })).toEqual({
				serviceTier,
			});
		}
		expect(buildConnectionUpdate({})).toEqual({});
	});

	it.each([
		"auto",
		"default",
		"flex",
		"",
		true,
		1,
		{},
	])("ignores invalid wire tier %j", (serviceTier) => {
		expect(readSessionConnectionUpdate({ serviceTier })).toEqual({});
	});

	it("does not clear priority when disabling reasoning", () => {
		const updates = buildConnectionUpdate({
			serviceTier: "priority",
			thinking: false,
		});
		expect(normalizeConnectionUpdate(updates)).toEqual({
			serviceTier: "priority",
			thinking: false,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
		});
	});

	it("validates and forwards the independent runtime option", () => {
		const base = {
			providerId: "openai",
			modelId: "test",
			systemPrompt: "test",
			tools: [],
		};
		for (const thinking of [true, false]) {
			const config = AgentConfigSchema.parse({
				...base,
				thinking,
				serviceTier: "priority",
			});
			expect(buildModelOptions(config)).toMatchObject({
				thinking,
				serviceTier: "priority",
			});
		}
		expect(
			AgentConfigSchema.safeParse({ ...base, serviceTier: "auto" }).success,
		).toBe(false);
		expect(buildModelOptions(AgentConfigSchema.parse(base))).not.toHaveProperty(
			"serviceTier",
		);
	});
});
