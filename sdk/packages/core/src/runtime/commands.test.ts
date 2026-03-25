import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUserInstructionConfigWatcher } from "../agents";
import {
	listAvailableRuntimeCommandsFromWatcher,
	resolveRuntimeSlashCommandFromWatcher,
} from "./commands";

describe("runtime command registry", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("lists workflow and skill commands together", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const skillDir = join(tempRoot, "skills", "debug");
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(skillDir, { recursive: true });
		await mkdir(workflowsDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "Use the debugging skill.");
		await writeFile(
			join(workflowsDir, "release.md"),
			`---
name: release
---
Run the release workflow.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [join(tempRoot, "skills")] },
			rules: { directories: [] },
			workflows: { directories: [workflowsDir] },
		});

		try {
			await watcher.start();
			expect(listAvailableRuntimeCommandsFromWatcher(watcher)).toEqual([
				{
					id: "debug",
					name: "debug",
					instructions: "Use the debugging skill.",
					kind: "skill",
				},
				{
					id: "release",
					name: "release",
					instructions: "Run the release workflow.",
					kind: "workflow",
				},
			]);
		} finally {
			watcher.stop();
		}
	});

	it("expands skill and workflow slash commands with workflow precedence", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const skillDir = join(tempRoot, "skills", "ship");
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(skillDir, { recursive: true });
		await mkdir(workflowsDir, { recursive: true });
		await writeFile(join(skillDir, "SKILL.md"), "Use the ship skill.");
		await writeFile(
			join(workflowsDir, "ship.md"),
			`---
name: ship
---
Run the ship workflow.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [join(tempRoot, "skills")] },
			rules: { directories: [] },
			workflows: { directories: [workflowsDir] },
		});

		try {
			await watcher.start();
			expect(resolveRuntimeSlashCommandFromWatcher("/ship", watcher)).toBe(
				"Run the ship workflow.",
			);
			expect(resolveRuntimeSlashCommandFromWatcher("/ship now", watcher)).toBe(
				"Run the ship workflow. now",
			);
		} finally {
			watcher.stop();
		}
	});
});
