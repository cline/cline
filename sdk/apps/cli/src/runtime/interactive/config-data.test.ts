import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserInstructionConfigService } from "@clinebot/core";
import { afterEach, describe, expect, it } from "vitest";
import type { InteractiveConfigItem } from "../../tui/interactive-config";
import type { Config } from "../../utils/types";
import { createInteractiveConfigDataLoader } from "./config-data";

function createConfig(cwd: string): Config {
	return {
		apiKey: "test-key",
		cwd,
		workspaceRoot: cwd,
		systemPrompt: "",
		modelId: "test-model",
		providerId: "test-provider",
		mode: "act",
		verbose: false,
		sandbox: false,
		thinking: false,
		outputMode: "text",
		defaultToolAutoApprove: false,
		toolPolicies: { "*": { autoApprove: false } },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	};
}

describe("interactive config data loader", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
	};

	afterEach(async () => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("toggles a skill item to the opposite enabled state and refreshes before reload", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		const skillPath = join(tempRoot, "SKILL.md");
		await writeFile(
			skillPath,
			`---
name: skill-one
---
Use this skill.`,
		);

		const calls: string[] = [];
		let refreshed = false;
		const userInstructionService = {
			async refreshType(type: string) {
				calls.push(`refreshType:${type}`);
				refreshed = true;
			},
			listRecords(type: string) {
				calls.push(`listRecords:${type}`);
				if (type !== "skill") {
					return [];
				}
				return [
					{
						id: "skill-one",
						type: "skill",
						filePath: skillPath,
						item: {
							name: "skill-one",
							disabled: refreshed,
							description: "Skill one",
							instructions: "Use this skill.",
							frontmatter: {},
						},
					},
				];
			},
		} as unknown as UserInstructionConfigService;
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
			userInstructionService,
		});
		const item: InteractiveConfigItem = {
			id: "skill-one",
			name: "skill-one",
			path: skillPath,
			enabled: true,
			source: "workspace",
			kind: "skill",
		};

		const data = await loader.onToggleConfigItem(item);
		const written = await readFile(skillPath, "utf8");

		expect(written).toContain("disabled: true");
		expect(data?.skills[0]?.enabled).toBe(false);
		expect(calls).toContain("refreshType:skill");
		expect(calls.indexOf("listRecords:skill")).toBeGreaterThan(
			calls.indexOf("refreshType:skill"),
		);
	});

	it("keeps plugin tool toggle behavior", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		const pluginToolPath = join(tempRoot, "plugin-tool.js");
		await writeFile(pluginToolPath, "export {};\n");
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});
		const item: InteractiveConfigItem = {
			id: "plugin:tool:path",
			name: "plugin-tool",
			path: pluginToolPath,
			enabled: true,
			source: "workspace-plugin",
			kind: "tool",
		};

		const data = await loader.onToggleConfigItem(item);
		const settings = JSON.parse(
			await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
		) as { disabledTools?: string[] };

		expect(settings.disabledTools).toEqual(["plugin-tool"]);
		expect(data).toBeDefined();
	});

	it("toggles every SDK tool name for a displayed built-in tool", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});
		const item: InteractiveConfigItem = {
			id: "editor",
			name: "editor",
			path: "editor, apply_patch",
			enabled: true,
			source: "builtin",
			kind: "tool",
			configKind: "tool",
			toolNames: ["editor", "apply_patch"],
		};

		await loader.onToggleConfigItem(item);
		const settings = JSON.parse(
			await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
		) as { disabledTools?: string[] };

		expect(settings.disabledTools).toEqual(["apply_patch", "editor"]);
	});

	it("loads and toggles plugin enabled state from global settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const pluginPath = join(pluginsDir, "workspace-plugin.js");
		await writeFile(pluginPath, "export default {};\n");
		await writeFile(
			process.env.CLINE_GLOBAL_SETTINGS_PATH,
			JSON.stringify({ disabledPlugins: [pluginPath] }, null, 2),
		);
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});

		const data = await loader.loadConfigData();
		const plugin = data.plugins.find((item) => item.path === pluginPath);
		expect(plugin?.enabled).toBe(false);

		const nextData = await loader.onToggleConfigItem(plugin!);
		const settings = JSON.parse(
			await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
		) as { disabledPlugins?: string[] };

		expect(settings.disabledPlugins).toBeUndefined();
		expect(
			nextData?.plugins.find((item) => item.path === pluginPath)?.enabled,
		).toBe(true);
	});

	it("does not toggle workflow items", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		const workflowPath = join(tempRoot, "workflow.md");
		await writeFile(workflowPath, "Run this workflow.");
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});
		const item: InteractiveConfigItem = {
			id: "workflow-one",
			name: "workflow-one",
			path: workflowPath,
			enabled: true,
			source: "workspace",
			kind: "workflow",
		};

		await expect(loader.onToggleConfigItem(item)).resolves.toBeUndefined();
		expect(await readFile(workflowPath, "utf8")).toBe("Run this workflow.");
	});

	it("returns undefined for non-toggleable items", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		await mkdir(join(tempRoot, "hooks"));
		const hookPath = join(tempRoot, "hooks", "hook.json");
		await writeFile(hookPath, "{}");
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});
		const item: InteractiveConfigItem = {
			id: hookPath,
			name: "hook.json",
			path: hookPath,
			enabled: true,
			source: "workspace",
			kind: "hook",
		};

		await expect(loader.onToggleConfigItem(item)).resolves.toBeUndefined();
	});
});
