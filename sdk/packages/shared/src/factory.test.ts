import { describe, expect, it } from "vitest";
import {
	factoryAgentsSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "./factory";
import { factoryDesignProgressSchema } from "./tasks";

describe("Factory implementer roster", () => {
	it("normalizes saved task, design and run agents without losing the original profile", () => {
		const implementer = {
			profile: "builder",
			resolvedProfile: {
				name: "builder",
				description: "Build",
				systemPrompt: "Keep scope small",
			},
			modelSelection: { providerId: "provider", modelId: "model" },
		};
		const agents = { implementer };
		const task = factoryTaskConfigSchema.parse({ agents });
		const design = factoryDesignProgressSchema.parse({
			agents,
			revision: 1,
			repairRound: 0,
			designerSessionId: "designer",
			findings: [],
			phase: "designing",
		});
		const run = factoryRunStateSchema.parse({
			agents,
			phase: "implementing",
			repairRound: 0,
			sessions: [],
			workspace: {
				path: "/candidate",
				branch: "feature",
				baseBranch: "main",
				baseCommit: "base",
			},
		});
		for (const normalized of [task.agents, design.agents, run.agents]) {
			expect(normalized?.implementers).toEqual([implementer]);
			expect(normalized).not.toHaveProperty("implementer");
		}
	});

	it("defaults to one implementer, bounds the roster, and prefers explicit roster over legacy input", () => {
		expect(factoryAgentsSchema.parse({}).implementers).toEqual([{}]);
		expect(factoryAgentsSchema.safeParse({ implementers: [] }).success).toBe(
			false,
		);
		expect(
			factoryAgentsSchema.safeParse({ implementers: [{}, {}, {}, {}] }).success,
		).toBe(true);
		expect(
			factoryAgentsSchema.safeParse({ implementers: [{}, {}, {}, {}, {}] })
				.success,
		).toBe(false);
		expect(
			factoryAgentsSchema.parse({
				implementer: { profile: "old" },
				implementers: [{ profile: "new" }],
			}).implementers,
		).toEqual([{ profile: "new" }]);
	});
});
