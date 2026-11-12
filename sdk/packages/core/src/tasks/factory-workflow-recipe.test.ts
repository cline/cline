import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factoryTaskConfigSchema } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	createFactoryWorkflowRecipe,
	normalizeFactoryTaskWorkflow,
	readFactoryWorkflowFile,
	validateFactoryWorkflowRecipe,
} from "./factory-workflow-recipe";

const verifier = {
	instructions:
		"Setup: bun install\nStart: bun run dev:web\nReady when: http://localhost:3125 responds\nCleanup: stop the dev server",
	artifacts: ["artifacts/home.png"],
};
const workflow = {
	maxRepairRounds: 3,
	approval: "automatic",
	agents: {
		implementer: {
			profile: "builder",
			resolvedProfile: {
				name: "builder",
				description: "Local profile",
				systemPrompt: "machine-local prompt",
				path: "/Users/someone/.cline/agents/builder.md",
			},
		},
		verifier,
	},
};

describe("Factory workflow recipes", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((path) => rm(path, { recursive: true })),
		);
	});

	it("exports a portable recipe whose revision survives a JSON round trip", () => {
		const recipe = createFactoryWorkflowRecipe({
			name: "Repo app",
			config: workflow,
		});
		expect(recipe.config.agents?.implementers).toEqual([
			{ profile: "builder" },
		]);
		expect(JSON.stringify(recipe)).not.toContain("machine-local prompt");
		expect(recipe.config.agents?.verifier).toEqual(verifier);

		const imported = validateFactoryWorkflowRecipe(
			JSON.parse(JSON.stringify(recipe)),
		);
		expect(imported).toEqual(recipe);
		// Input key order and legacy aliases do not change the revision.
		const reordered = createFactoryWorkflowRecipe({
			name: "Repo app",
			config: {
				agents: { verifier, implementers: [{ profile: "builder" }] },
				approval: "automatic",
				maxRepairRounds: 3,
			},
		});
		expect(reordered.revision).toBe(recipe.revision);
	});

	it("rejects edited configuration, unsupported versions and invalid shapes", () => {
		const recipe = createFactoryWorkflowRecipe({
			name: "Repo app",
			config: workflow,
		});
		expect(() =>
			validateFactoryWorkflowRecipe({
				...recipe,
				config: { ...recipe.config, maxRepairRounds: 4 },
			}),
		).toThrow("revision does not match");
		expect(() =>
			validateFactoryWorkflowRecipe({ ...recipe, schemaVersion: 2 }),
		).toThrow();
		expect(() =>
			validateFactoryWorkflowRecipe({
				...recipe,
				config: { ...recipe.config, maxRepairRounds: 99 },
			}),
		).toThrow();
	});

	it("revises only the workflow portion of a task, including verifier app instructions", () => {
		const task = factoryTaskConfigSchema.parse({
			...workflow,
			workflow: { name: "Repo app", revision: "0".repeat(64) },
			checks: [{ name: "unit", command: "bun test", kind: "test" }],
			acceptanceCriteria: [
				{ id: "saves", text: "Saving keeps the draft", check: "unit" },
			],
		});
		const normalized = normalizeFactoryTaskWorkflow(task);
		expect(normalized.workflow).toEqual({
			name: "Repo app",
			revision: createFactoryWorkflowRecipe({
				name: "Repo app",
				config: workflow,
			}).revision,
		});
		// Frozen runtime profiles stay with the task; they are not recipe content.
		expect(normalized.agents?.implementers[0]?.resolvedProfile?.name).toBe(
			"builder",
		);
		expect(
			normalizeFactoryTaskWorkflow({
				...task,
				checks: [],
				acceptanceCriteria: undefined,
			}).workflow,
		).toEqual(normalized.workflow);

		const changedApp = normalizeFactoryTaskWorkflow(
			factoryTaskConfigSchema.parse({
				...task,
				agents: {
					...task.agents,
					verifier: { ...verifier, instructions: "Start: bun run dev" },
				},
			}),
		);
		expect(changedApp.workflow?.revision).not.toBe(
			normalized.workflow?.revision,
		);
	});

	it("reads repository recipes only from relative paths inside the workspace", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "factory-recipe-"));
		directories.push(workspaceRoot);
		const recipe = createFactoryWorkflowRecipe({
			name: "Repo app",
			config: workflow,
		});
		await writeFile(
			join(workspaceRoot, "workflow.json"),
			JSON.stringify(recipe),
		);

		await expect(
			readFactoryWorkflowFile({ workspaceRoot, path: "workflow.json" }),
		).resolves.toEqual(recipe);
		await expect(
			readFactoryWorkflowFile({
				workspaceRoot,
				path: join(workspaceRoot, "workflow.json"),
			}),
		).rejects.toThrow("relative");
		await expect(
			readFactoryWorkflowFile({ workspaceRoot, path: "../workflow.json" }),
		).rejects.toThrow("without '..'");
	});
});
