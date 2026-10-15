import type { AgendaTaskRecord, FactoryAgent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveFactoryAgent } from "./factory-agents";

const task: AgendaTaskRecord = {
	taskId: "feature",
	type: "todo",
	status: "approved",
	title: "Implement feature",
	instructions: "Implement the approved requirement.",
	scope: "workspace",
	workspaceRoot: "/workspace",
	resourcePaths: [],
	priority: 3,
	availableAt: "2035-01-01T00:00:00.000Z",
	expiresAt: "2035-01-10T00:00:00.000Z",
	automationEligible: false,
	revision: 1,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	createdAt: "2035-01-01T00:00:00.000Z",
	updatedAt: "2035-01-01T00:00:00.000Z",
	modelSelection: { providerId: "anthropic", modelId: "task-model" },
	systemPrompt: "Respect the approved scope.",
	maxIterations: 20,
	timeoutSeconds: 120,
};

describe("resolveFactoryAgent", () => {
	it("resolves independent reviewer and implementer settings without changing the approved task", () => {
		const before = structuredClone(task);
		const reviewer: FactoryAgent = {
			modelSelection: { providerId: "openai", modelId: "review-model" },
			instructions: "Review correctness and maintainability.",
			maxIterations: 5,
			timeoutSeconds: 30,
		};
		const reviewed = resolveFactoryAgent(task, reviewer);
		const implemented = resolveFactoryAgent(task, {
			instructions: "Implement the feature.",
		});
		expect(reviewed).toMatchObject({
			modelSelection: reviewer.modelSelection,
			instructions: task.instructions,
			systemPrompt:
				"Respect the approved scope.\n\nReview correctness and maintainability.",
			maxIterations: 5,
			timeoutSeconds: 30,
		});
		expect(implemented).toMatchObject({
			modelSelection: task.modelSelection,
			systemPrompt: "Respect the approved scope.\n\nImplement the feature.",
			maxIterations: 20,
			timeoutSeconds: 120,
		});
		expect(task).toEqual(before);
		expect(reviewer.instructions).toBe(
			"Review correctness and maintainability.",
		);
	});

	it("keeps task caps authoritative when an agent requests larger limits", () => {
		expect(
			resolveFactoryAgent(task, { maxIterations: 100, timeoutSeconds: 600 }),
		).toMatchObject({ maxIterations: 20, timeoutSeconds: 120 });
	});

	it("uses agent bounds when the task has none and preserves absent bounds for default agents", () => {
		const unbounded = {
			...task,
			maxIterations: undefined,
			timeoutSeconds: undefined,
			systemPrompt: undefined,
		};
		expect(
			resolveFactoryAgent(unbounded, {
				maxIterations: 3,
				timeoutSeconds: 10,
				instructions: "Inspect the plan.",
			}),
		).toMatchObject({
			maxIterations: 3,
			timeoutSeconds: 10,
			systemPrompt: "Inspect the plan.",
		});
		const inherited = resolveFactoryAgent(unbounded, {});
		expect(inherited.maxIterations).toBeUndefined();
		expect(inherited.timeoutSeconds).toBeUndefined();
		expect(inherited.systemPrompt).toBeUndefined();
	});
});
