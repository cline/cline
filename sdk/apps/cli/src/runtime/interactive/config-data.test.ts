import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserInstructionConfigService } from "@cline/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildSlashCommandRegistry,
	expandUserCommandPrompt,
} from "../../tui/commands/slash-command-registry";
import {
	applyPluginFailures,
	type InteractiveConfigItem,
} from "../../tui/interactive-config";
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
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
	};

	afterEach(async () => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH =
			envSnapshot.CLINE_GLOBAL_SETTINGS_PATH;
		process.env.CLINE_MCP_SETTINGS_PATH = envSnapshot.CLINE_MCP_SETTINGS_PATH;
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	async function writeSettingsPlugin(tempRoot: string): Promise<string> {
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const pluginPath = join(pluginsDir, "settings-plugin.js");
		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'settings-plugin',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup(api) {",
				"    api.registerTool({",
				"      name: 'settings_plugin_tool',",
				"      description: 'Settings plugin tool',",
				"      inputSchema: { type: 'object', properties: {} },",
				"      execute: async () => 'ok',",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);
		return pluginPath;
	}

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
			listRuntimeCommands() {
				calls.push("listRuntimeCommands");
				return refreshed
					? []
					: [
							{
								name: "skill-one",
								instructions: "Use this skill.",
								description: "Skill one",
								kind: "skill",
							},
						];
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
		expect(
			data?.workflowSlashCommands.map((command) => command.name),
		).not.toContain("skill-one");
		expect(calls).toContain("refreshType:skill");
		expect(calls.lastIndexOf("listRecords:skill")).toBeGreaterThan(
			calls.indexOf("refreshType:skill"),
		);
	});

	it("returns refreshed slash commands so disabled skills stop expanding before submit", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		const skillPath = join(tempRoot, "SKILL.md");
		await writeFile(
			skillPath,
			`---
name: find-skills
---
Find installable skills.`,
		);

		let refreshed = false;
		const userInstructionService = {
			async refreshType() {
				refreshed = true;
			},
			listRuntimeCommands() {
				return refreshed
					? []
					: [
							{
								name: "find-skills",
								instructions: "Find installable skills.",
								description: "Find skills",
								kind: "skill",
							},
						];
			},
			listRecords(type: string) {
				if (type !== "skill") {
					return [];
				}
				return [
					{
						id: "find-skills",
						type: "skill",
						filePath: skillPath,
						item: {
							name: "find-skills",
							disabled: refreshed,
							description: "Find skills",
							instructions: "Find installable skills.",
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
		const initialData = await loader.loadConfigData();
		const initialRegistry = buildSlashCommandRegistry({
			workflowSlashCommands: initialData.workflowSlashCommands,
		});

		expect(
			expandUserCommandPrompt("/find-skills what can u do?", initialRegistry),
		).toContain("<user_command");

		const nextData = await loader.onToggleConfigItem({
			id: "find-skills",
			name: "find-skills",
			path: skillPath,
			enabled: true,
			source: "workspace",
			kind: "skill",
		});
		const refreshedRegistry = buildSlashCommandRegistry({
			workflowSlashCommands: nextData?.workflowSlashCommands,
		});

		expect(
			nextData?.workflowSlashCommands.map((command) => command.name),
		).not.toContain("find-skills");
		expect(
			expandUserCommandPrompt("/find-skills what can u do?", refreshedRegistry),
		).toBe("/find-skills what can u do?");
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
		expect(data).toBeUndefined();
	});

	it("can skip plugin tool imports for fast settings open", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		const pluginPath = await writeSettingsPlugin(tempRoot);
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});

		const data = await loader.loadConfigData({ includePluginTools: false });

		expect(data.plugins.some((item) => item.path === pluginPath)).toBe(true);
		expect(
			data.tools.some((item) => item.pluginName === "settings-plugin"),
		).toBe(false);
	});

	it("loads plugin tools when requested", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		await writeSettingsPlugin(tempRoot);
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});

		const data = await loader.loadConfigData({ includePluginTools: true });

		expect(
			data.tools.some(
				(item) =>
					item.pluginName === "settings-plugin" &&
					item.name === "settings_plugin_tool",
			),
		).toBe(true);
	});

	it("keeps failed plugins visible with their load error", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			tempRoot,
			"global-settings.json",
		);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const pluginPath = join(pluginsDir, "broken-plugin.js");
		const invalidPluginPath = join(pluginsDir, "invalid-plugin.js");
		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'broken-plugin',",
				"  manifest: { capabilities: ['tools'] },",
				"  setup() {",
				"    throw new Error('setup exploded');",
				"  },",
				"};",
			].join("\n"),
		);
		await writeFile(invalidPluginPath, "export default {};\n", "utf8");
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});

		const data = await loader.loadConfigData({ includePluginTools: true });
		const plugin = data.plugins.find((item) => item.path === pluginPath);

		expect(plugin?.name).toBe("broken-plugin");
		expect(plugin?.loadErrorPhase).toBe("setup");
		expect(plugin?.loadError).toContain("setup failed: setup exploded");

		const invalidPlugin = data.plugins.find(
			(item) => item.path === invalidPluginPath,
		);
		expect(invalidPlugin?.name).toBe("invalid-plugin");
		expect(invalidPlugin?.loadErrorPhase).toBe("load");
		expect(invalidPlugin?.loadError).toContain("load failed:");
	});

	it("preserves multiple load failures for the same plugin path", () => {
		const plugin: InteractiveConfigItem = {
			id: "/tmp/plugin.js",
			name: "plugin",
			path: "/tmp/plugin.js",
			enabled: true,
			kind: "plugin",
			source: "workspace-plugin",
		};

		applyPluginFailures(
			[plugin],
			[
				{
					pluginPath: "/tmp/plugin.js",
					pluginName: "plugin",
					phase: "setup",
					message: "first failure",
				},
				{
					pluginPath: "/tmp/plugin.js",
					phase: "setup",
					message: "second failure",
				},
			],
		);

		expect(plugin.loadError).toBe(
			"setup failed: first failure\nsetup failed: second failure",
		);
		expect(plugin.loadErrorPhase).toBeUndefined();
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
		if (!plugin) {
			throw new Error("Expected workspace plugin to be listed");
		}

		const nextData = await loader.onToggleConfigItem(plugin);
		const refreshedData = await loader.loadConfigData();
		const settings = JSON.parse(
			await readFile(process.env.CLINE_GLOBAL_SETTINGS_PATH, "utf8"),
		) as { disabledPlugins?: string[] };

		expect(settings.disabledPlugins).toBeUndefined();
		expect(nextData).toBeUndefined();
		expect(
			refreshedData.plugins.find((item) => item.path === pluginPath)?.enabled,
		).toBe(true);
	});

	it("uses the package name for package-backed plugin entries", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		const packageDir = join(
			tempRoot,
			".cline",
			"plugins",
			"_installed",
			"git",
			"github.com",
			"demo",
			"package",
		);
		await mkdir(packageDir, { recursive: true });
		const pluginPath = join(packageDir, "index.ts");
		await writeFile(
			join(packageDir, "package.json"),
			JSON.stringify(
				{
					name: "cline-sdk-portable-agents",
					cline: {
						plugins: [{ paths: ["./index.ts"] }],
					},
				},
				null,
				2,
			),
		);
		await writeFile(pluginPath, "export default {};\n");
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});

		const data = await loader.loadConfigData();
		const plugin = data.plugins.find((item) => item.path === pluginPath);

		expect(plugin?.name).toBe("cline-sdk-portable-agents");
	});

	it("toggles MCP server enabled state through core settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-config-data-"));
		tempRoots.push(tempRoot);
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		await writeFile(
			settingsPath,
			`${JSON.stringify(
				{
					otherSetting: true,
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
					},
				},
				null,
				2,
			)}\n`,
		);
		const loader = createInteractiveConfigDataLoader({
			config: createConfig(tempRoot),
		});

		const data = await loader.loadConfigData();
		const item = data.mcp.find((candidate) => candidate.name === "docs");
		expect(item?.enabled).toBe(true);

		const nextData = item ? await loader.onToggleConfigItem(item) : undefined;
		const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
			otherSetting?: boolean;
			mcpServers?: Record<string, { disabled?: boolean }>;
		};

		expect(settings.otherSetting).toBe(true);
		expect(settings.mcpServers?.docs?.disabled).toBe(true);
		expect(
			nextData?.mcp.find((candidate) => candidate.name === "docs")?.enabled,
		).toBe(false);
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
