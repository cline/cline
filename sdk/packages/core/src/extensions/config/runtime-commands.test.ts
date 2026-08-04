import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	listAvailableRuntimeCommandsFromWatcher,
	resolveRuntimeSlashCommandFromWatcher,
} from "./runtime-commands";
import { toggleSkillFrontmatter } from "./skill-frontmatter-toggle";
import { createUserInstructionConfigWatcher } from "./user-instruction-config-loader";

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
			await watcher.refreshAll();
			expect(listAvailableRuntimeCommandsFromWatcher(watcher)).toEqual([
				{
					id: "debug",
					name: "debug",
					description: "Use the debugging skill.",
					instructions: "Use the debugging skill.",
					kind: "skill",
				},
				{
					id: "release",
					name: "release",
					description: undefined,
					instructions: "Run the release workflow.",
					kind: "workflow",
				},
			]);
		} finally {
			watcher.stop();
		}
	});

	it("qualifies colliding commands by kind and ignores disabled entries", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const skillDir = join(tempRoot, "skills", "publish-ui");
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(skillDir, { recursive: true });
		await mkdir(workflowsDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: publish-ui
---
Use the publish UI skill.`,
		);
		await writeFile(
			join(workflowsDir, "publish-ui.md"),
			`---
name: Publish UI
---
Run the publish UI workflow.`,
		);
		await writeFile(
			join(workflowsDir, "disabled.md"),
			`---
name: disabled
disabled: true
---
Do not run this workflow.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [join(tempRoot, "skills")] },
			rules: { directories: [] },
			workflows: { directories: [workflowsDir] },
		});

		try {
			await watcher.refreshAll();
			expect(
				resolveRuntimeSlashCommandFromWatcher("/publish-ui", watcher),
			).toBe("/publish-ui");
			expect(
				resolveRuntimeSlashCommandFromWatcher("/publish-ui-workflow", watcher),
			).toBe("Run the publish UI workflow.");
			expect(
				resolveRuntimeSlashCommandFromWatcher("/publish-ui-skill now", watcher),
			).toBe("Use the publish UI skill. now");
			expect(
				listAvailableRuntimeCommandsFromWatcher(watcher).map((command) => ({
					name: command.name,
					kind: command.kind,
				})),
			).toEqual([
				{ name: "publish-ui-skill", kind: "skill" },
				{ name: "publish-ui-workflow", kind: "workflow" },
			]);
			expect(resolveRuntimeSlashCommandFromWatcher("/disabled", watcher)).toBe(
				"/disabled",
			);
			expect(resolveRuntimeSlashCommandFromWatcher("/missing", watcher)).toBe(
				"/missing",
			);
			expect(
				resolveRuntimeSlashCommandFromWatcher("please run /ship", watcher),
			).toBe("please run /ship");
		} finally {
			watcher.stop();
		}
	});

	it("normalizes configured names into resolvable slash command tokens", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const skillDir = join(tempRoot, "skills", "publish-ui");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---
name: "  Publish UI  "
---
Publish the UI package.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [join(tempRoot, "skills")] },
			rules: { directories: [] },
			workflows: { directories: [] },
		});

		try {
			await watcher.refreshAll();
			expect(listAvailableRuntimeCommandsFromWatcher(watcher)[0]?.name).toBe(
				"publish-ui",
			);
			expect(
				resolveRuntimeSlashCommandFromWatcher("/publish-ui now", watcher),
			).toBe("Publish the UI package. now");
			expect(
				resolveRuntimeSlashCommandFromWatcher("/PUBLISH-UI now", watcher),
			).toBe("Publish the UI package. now");
		} finally {
			watcher.stop();
		}
	});

	it("keeps every same-kind normalized name collision reachable", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const skillsDir = join(tempRoot, "skills");
		const firstSkillDir = join(skillsDir, "publish-ui-stable");
		const secondSkillDir = join(skillsDir, "publish-ui-preview");
		await mkdir(firstSkillDir, { recursive: true });
		await mkdir(secondSkillDir, { recursive: true });
		await writeFile(
			join(firstSkillDir, "SKILL.md"),
			`---
name: Publish UI
---
Publish the stable UI.`,
		);
		await writeFile(
			join(secondSkillDir, "SKILL.md"),
			`---
name: publish-ui
---
Publish the preview UI.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [skillsDir] },
			rules: { directories: [] },
			workflows: { directories: [] },
		});

		try {
			await watcher.refreshAll();
			const commands = listAvailableRuntimeCommandsFromWatcher(watcher);
			expect(commands.map((command) => command.name)).toEqual([
				"publish-ui-skill-publish-ui",
				"publish-ui-skill-publish-ui-2",
			]);
			expect(
				new Set(
					commands.map((command) =>
						resolveRuntimeSlashCommandFromWatcher(`/${command.name}`, watcher),
					),
				),
			).toEqual(new Set(["Publish the stable UI.", "Publish the preview UI."]));
		} finally {
			watcher.stop();
		}
	});

	it("leaves workflow display description blank when no description is set", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(workflowsDir, { recursive: true });
		await writeFile(
			join(workflowsDir, "review.md"),
			`# Review Current Branch

Review the current branch and summarize findings.
`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { directories: [] },
			workflows: { directories: [workflowsDir] },
		});

		try {
			await watcher.refreshAll();
			expect(listAvailableRuntimeCommandsFromWatcher(watcher)).toEqual([
				{
					id: "review",
					name: "review",
					description: undefined,
					instructions:
						"# Review Current Branch\n\nReview the current branch and summarize findings.",
					kind: "workflow",
				},
			]);
		} finally {
			watcher.stop();
		}
	});

	it("reflects skill frontmatter toggles after watcher refresh", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-commands-"));
		tempRoots.push(tempRoot);
		const skillDir = join(tempRoot, "skills", "review");
		await mkdir(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		await writeFile(skillPath, "Use the review skill.");

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [join(tempRoot, "skills")] },
			rules: { directories: [] },
			workflows: { directories: [] },
		});

		try {
			await watcher.refreshAll();
			expect(resolveRuntimeSlashCommandFromWatcher("/review", watcher)).toBe(
				"Use the review skill.",
			);

			await toggleSkillFrontmatter({ filePath: skillPath, enabled: false });
			await watcher.refreshType("skill");

			expect(resolveRuntimeSlashCommandFromWatcher("/review", watcher)).toBe(
				"/review",
			);
		} finally {
			watcher.stop();
		}
	});
});
