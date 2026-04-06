import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUserInstructionConfigWatcher } from "../extensions";
import {
	listAvailableWorkflowsFromWatcher,
	resolveWorkflowSlashCommandFromWatcher,
} from "./workflows";

describe("runtime workflows helpers", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("lists only enabled workflows from watcher snapshots", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-workflows-"));
		tempRoots.push(tempRoot);
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(workflowsDir, { recursive: true });
		await writeFile(
			join(workflowsDir, "enabled.md"),
			`---
name: enabled-workflow
---
Run enabled workflow.`,
		);
		await writeFile(
			join(workflowsDir, "disabled.md"),
			`---
name: disabled-workflow
disabled: true
---
Run disabled workflow.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { directories: [] },
			workflows: { directories: [workflowsDir] },
		});

		try {
			await watcher.start();
			expect(listAvailableWorkflowsFromWatcher(watcher)).toEqual([
				{
					id: "enabled-workflow",
					name: "enabled-workflow",
					instructions: "Run enabled workflow.",
				},
			]);
		} finally {
			watcher.stop();
		}
	});

	it("expands leading slash commands and preserves trailing user text", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-runtime-workflows-"));
		tempRoots.push(tempRoot);
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(workflowsDir, { recursive: true });
		await writeFile(
			join(workflowsDir, "release.md"),
			`---
name: release
---
Run the release workflow.`,
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
			skills: { directories: [] },
			rules: { directories: [] },
			workflows: { directories: [workflowsDir] },
		});

		try {
			await watcher.start();
			expect(resolveWorkflowSlashCommandFromWatcher("/release", watcher)).toBe(
				"Run the release workflow.",
			);
			expect(
				resolveWorkflowSlashCommandFromWatcher("  /release  ", watcher),
			).toBe("  /release  ");
			expect(resolveWorkflowSlashCommandFromWatcher("/disabled", watcher)).toBe(
				"/disabled",
			);
			expect(resolveWorkflowSlashCommandFromWatcher("/missing", watcher)).toBe(
				"/missing",
			);
			expect(
				resolveWorkflowSlashCommandFromWatcher("/release now", watcher),
			).toBe("Run the release workflow. now");
			expect(
				resolveWorkflowSlashCommandFromWatcher(
					"/release   use javascript",
					watcher,
				),
			).toBe("Run the release workflow.   use javascript");
			expect(
				resolveWorkflowSlashCommandFromWatcher("please run /release", watcher),
			).toBe("please run /release");
		} finally {
			watcher.stop();
		}
	});
});
