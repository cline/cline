import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExtensionRule } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createUserInstructionConfigWatcher } from "./user-instruction-config-loader";
import { createUserInstructionPlugin } from "./user-instruction-plugin";

describe("user instruction rules", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	it("refreshes rules before each system prompt", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-user-instruction-plugin-"),
		);
		tempRoots.push(tempRoot);
		const skillsDir = join(tempRoot, "skills");
		const workflowsDir = join(tempRoot, "workflows");
		const rulesPath = join(tempRoot, ".clinerules");
		await Promise.all([
			mkdir(skillsDir, { recursive: true }),
			mkdir(workflowsDir, { recursive: true }),
		]);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [skillsDir] },
			rules: { directories: [rulesPath] },
			workflows: { directories: [workflowsDir] },
		});
		await watcher.start();

		let registeredRule: AgentExtensionRule | undefined;
		const plugin = createUserInstructionPlugin({
			watcher,
			includeRules: true,
		});
		await plugin.setup?.(
			{
				registerRule: (rule: AgentExtensionRule) => (registeredRule = rule),
			} as never,
			{} as never,
		);
		const resolveRules = async () => {
			const content = registeredRule?.content;
			return typeof content === "function" ? await content() : content;
		};

		try {
			expect(await resolveRules()).toBe("");

			await writeFile(rulesPath, "Ack with style-v1.");
			expect(await resolveRules()).toContain("style-v1");

			const replacement = join(tempRoot, ".clinerules.tmp");
			await writeFile(replacement, "Ack with style-v2.");
			await rename(replacement, rulesPath);
			expect(await resolveRules()).toContain("style-v2");
		} finally {
			watcher.stop();
		}
	});
});
