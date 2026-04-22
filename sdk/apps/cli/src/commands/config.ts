import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import {
	type BuiltinToolAvailabilityContext,
	createUserInstructionConfigWatcher,
	discoverPluginModulePaths,
	hasMcpSettingsFile,
	listHookConfigFiles,
	listPluginTools,
	type RuleConfig,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
	resolvePluginConfigSearchPaths,
	resolveRulesConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	type SkillConfig,
	type WorkflowConfig,
} from "@clinebot/core";
import { Command } from "commander";
import { getToolCatalog } from "../runtime/tools";
import { loadInteractiveConfigData } from "../tui/interactive-config";
import type { CliOutputMode } from "../utils/types";

type ConfigIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

function resolveCliAgentConfigSearchPaths(cwd: string): string[] {
	const clineDir = process.env.CLINE_DIR?.trim() || join(homedir(), ".cline");
	return [join(cwd, ".cline", "agents"), join(clineDir, "agents")];
}

async function runWorkflowsConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const workflowsById = new Map<
		string,
		{ id: string; name: string; instructions: string; path: string }
	>();
	const directories = resolveWorkflowsConfigSearchPaths(cwd).filter(
		(directory) => existsSync(directory),
	);
	for (const directory of directories) {
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { directories: [] },
			workflows: { directories: [directory] },
		});
		try {
			await watcher.start();
			const snapshot = watcher.getSnapshot("workflow");
			for (const [id, record] of snapshot.entries()) {
				const workflow = record.item as WorkflowConfig;
				if (workflow.disabled === true || workflowsById.has(id)) {
					continue;
				}
				workflowsById.set(id, {
					id,
					name: workflow.name,
					instructions: workflow.instructions,
					path: record.filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		} finally {
			watcher.stop();
		}
	}
	const workflows = [...workflowsById.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(workflows));
		return 0;
	}
	if (workflows.length === 0) {
		io.writeln("No enabled workflows found.");
		return 0;
	}
	io.writeln("Available workflows:");
	for (const workflow of workflows) {
		io.writeln(`  /${workflow.name} (${workflow.path})`);
	}
	return 0;
}

async function runRulesConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const rulesByName = new Map<
		string,
		{ name: string; instructions: string; path: string }
	>();
	const directories = resolveRulesConfigSearchPaths(cwd).filter((directory) =>
		existsSync(directory),
	);
	for (const directory of directories) {
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { directories: [directory] },
			workflows: { directories: [] },
		});
		try {
			await watcher.start();
			const snapshot = watcher.getSnapshot("rule");
			for (const record of snapshot.values()) {
				const rule = record.item as RuleConfig;
				if (rule.disabled === true || rulesByName.has(rule.name)) {
					continue;
				}
				rulesByName.set(rule.name, {
					name: rule.name,
					instructions: rule.instructions,
					path: record.filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		} finally {
			watcher.stop();
		}
	}
	const rules = [...rulesByName.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(rules));
		return 0;
	}
	if (rules.length === 0) {
		io.writeln("No enabled rules found.");
		return 0;
	}
	io.writeln("Enabled rules:");
	for (const rule of rules) {
		io.writeln(`  ${rule.name} (${rule.path})`);
	}
	return 0;
}

async function runSkillsConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const skillDirectories = [
		...resolveSkillsConfigSearchPaths(cwd),
		join(homedir(), "Documents", "Cline", "Skills"),
	];
	const skillsByName = new Map<
		string,
		SkillConfig & {
			path: string;
		}
	>();
	const directories = [...new Set(skillDirectories)].filter((directory) =>
		existsSync(directory),
	);
	for (const directory of directories) {
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [directory] },
			rules: { directories: [] },
			workflows: { directories: [] },
		});
		try {
			await watcher.start();
			const snapshot = watcher.getSnapshot("skill");
			for (const record of snapshot.values()) {
				const skill = record.item as SkillConfig;
				if (skill.disabled === true || skillsByName.has(skill.name)) {
					continue;
				}
				skillsByName.set(skill.name, {
					...skill,
					path: record.filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		} finally {
			watcher.stop();
		}
	}
	const skills = [...skillsByName.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(skills));
		return 0;
	}
	if (skills.length === 0) {
		io.writeln("No enabled skills found.");
		return 0;
	}
	io.writeln("Enabled skills:");
	for (const skill of skills) {
		io.writeln(`  ${skill.name} (${skill.path})`);
	}
	return 0;
}

async function runAgentsConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const agentsById = new Map<
		string,
		{
			name: string;
			path: string;
		}
	>();
	const directories = resolveCliAgentConfigSearchPaths(cwd).filter(
		(directory) => existsSync(directory),
	);
	for (const directory of directories) {
		try {
			const entries = readdirSync(directory, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isFile()) {
					continue;
				}
				const extension = extname(entry.name).toLowerCase();
				if (extension !== ".yml" && extension !== ".yaml") {
					continue;
				}
				const filePath = join(directory, entry.name);
				const raw = readFileSync(filePath, "utf8");
				const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
				const frontmatter = frontmatterMatch?.[1] ?? "";
				const nameMatch = frontmatter.match(/^\s*name:\s*(.+?)\s*$/m);
				const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
				const name =
					parsedName && parsedName.length > 0
						? parsedName
						: basename(entry.name, extension);
				const id = name.toLowerCase();
				if (agentsById.has(id)) {
					continue;
				}
				agentsById.set(id, { name, path: filePath });
			}
		} catch {
			// Best-effort listing across config roots.
		}
	}

	const agents = [...agentsById.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(agents));
		return 0;
	}
	if (agents.length === 0) {
		io.writeln("No configured agents found.");
		return 0;
	}
	io.writeln("Configured agents:");
	for (const agent of agents) {
		io.writeln(`  ${agent.name} (${agent.path})`);
	}
	return 0;
}

async function runPluginsConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const pluginsByPath = new Map<
		string,
		{
			name: string;
			path: string;
		}
	>();
	const directories = resolvePluginConfigSearchPaths(cwd).filter((directory) =>
		existsSync(directory),
	);
	for (const directory of directories) {
		try {
			for (const filePath of discoverPluginModulePaths(directory)) {
				if (pluginsByPath.has(filePath)) {
					continue;
				}
				pluginsByPath.set(filePath, {
					name: basename(filePath, extname(filePath)),
					path: filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		}
	}

	const plugins = [...pluginsByPath.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(plugins));
		return 0;
	}
	if (plugins.length === 0) {
		io.writeln("No plugins found.");
		return 0;
	}
	io.writeln("Discovered plugins:");
	for (const plugin of plugins) {
		io.writeln(`  ${plugin.name} (${plugin.path})`);
	}
	return 0;
}

async function runHooksConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const hooks = listHookConfigFiles(cwd);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(hooks));
		return 0;
	}
	if (hooks.length === 0) {
		io.writeln("No hook files found.");
		return 0;
	}
	io.writeln("Hook files:");
	for (const item of hooks) {
		const mapped = item.hookEventName ? ` -> ${item.hookEventName}` : "";
		io.writeln(`  ${item.fileName}${mapped} (${item.path})`);
	}
	return 0;
}

async function runMcpConfigCommand(
	outputMode: CliOutputMode,
	io: ConfigIo,
): Promise<number> {
	const settingsPath = resolveDefaultMcpSettingsPath();
	if (!hasMcpSettingsFile({ filePath: settingsPath })) {
		if (outputMode === "json") {
			process.stdout.write(JSON.stringify([]));
			return 0;
		}
		io.writeln(`No MCP settings file found at ${settingsPath}`);
		return 0;
	}

	try {
		const servers = resolveMcpServerRegistrations({ filePath: settingsPath })
			.map((registration) => ({
				name: registration.name,
				transportType: registration.transport.type,
				disabled: registration.disabled === true,
				path: settingsPath,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		if (outputMode === "json") {
			process.stdout.write(JSON.stringify(servers));
			return 0;
		}
		if (servers.length === 0) {
			io.writeln(`No MCP servers configured in ${settingsPath}`);
			return 0;
		}
		io.writeln(`Configured MCP servers (${settingsPath}):`);
		for (const server of servers) {
			const disabledSuffix = server.disabled ? " (disabled)" : "";
			io.writeln(`  ${server.name} [${server.transportType}]${disabledSuffix}`);
		}
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function runToolsConfigCommand(
	cwd: string,
	outputMode: CliOutputMode,
	io: ConfigIo,
	availabilityContext?: BuiltinToolAvailabilityContext,
): Promise<number> {
	const tools = getToolCatalog(availabilityContext);
	const pluginTools = await listPluginTools({
		workspacePath: cwd,
		cwd,
	});

	if (outputMode === "json") {
		process.stdout.write(
			JSON.stringify([
				...tools,
				...pluginTools.map((tool) => ({
					name: tool.name,
					type: "plugin" as const,
					pluginName: tool.pluginName,
					path: tool.path,
					source: tool.source,
					enabled: tool.enabled,
					description: tool.description,
				})),
			]),
		);
		return 0;
	}
	if (tools.length === 0 && pluginTools.length === 0) {
		io.writeln("No tools found.");
		return 0;
	}
	io.writeln("Available tools:");
	for (const tool of tools) {
		const defaultState = tool.defaultEnabled ? "enabled" : "disabled";
		const names =
			tool.headlessToolNames.length === 1 &&
			tool.headlessToolNames[0] === tool.id
				? ""
				: ` -> ${tool.headlessToolNames.join(", ")}`;
		io.writeln(`  ${tool.id} [default: ${defaultState}]${names}`);
	}
	if (pluginTools.length > 0) {
		io.writeln();
		io.writeln("Plugin tools:");
		for (const tool of pluginTools) {
			io.writeln(
				`  ${tool.name} [plugin: ${tool.pluginName}] [${tool.enabled ? "enabled" : "disabled"}] (${tool.path})`,
			);
		}
	}
	return 0;
}

async function loadInteractiveConfigDataForCommand(
	cwd: string,
): Promise<Awaited<ReturnType<typeof loadInteractiveConfigData>>> {
	const watcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: cwd },
		rules: { workspacePath: cwd },
		workflows: { workspacePath: cwd },
	});
	try {
		await watcher.start();
		return await loadInteractiveConfigData({
			watcher,
			cwd,
			workspaceRoot: cwd,
			availabilityContext: {
				mode: "act",
			},
		});
	} finally {
		watcher.stop();
	}
}

export function createConfigCommand(
	getCwd: () => string,
	getOutputMode: () => CliOutputMode,
	io: ConfigIo,
	setExitCode: (code: number) => void,
	launchInteractiveConfigView: () => void,
): Command {
	let actionExitCode: number | undefined;

	const config = new Command("config")
		.description("Show current configuration")
		.argument("[target]")
		.option("--json", "Output as JSON")
		.option("--config <dir>", "configuration directory")
		.exitOverride()
		.action(async (target?: string) => {
			if (!target) {
				if (getOutputMode() === "json") {
					process.stdout.write(
						`${JSON.stringify(await loadInteractiveConfigDataForCommand(getCwd()))}\n`,
					);
					actionExitCode = 0;
					return;
				}
				actionExitCode = undefined;
				launchInteractiveConfigView();
				return;
			}

			switch (target) {
				case "workflows":
					actionExitCode = await runWorkflowsConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
					);
					break;
				case "rules":
					actionExitCode = await runRulesConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
					);
					break;
				case "skills":
					actionExitCode = await runSkillsConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
					);
					break;
				case "agents":
					actionExitCode = await runAgentsConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
					);
					break;
				case "plugins":
					actionExitCode = await runPluginsConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
					);
					break;
				case "hooks":
					actionExitCode = await runHooksConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
					);
					break;
				case "mcp":
					actionExitCode = await runMcpConfigCommand(getOutputMode(), io);
					break;
				case "tools":
					actionExitCode = await runToolsConfigCommand(
						getCwd(),
						getOutputMode(),
						io,
						{ mode: "act" },
					);
					break;
				default:
					io.writeErr(
						`config requires one of: workflows, rules, skills, agents, plugins, hooks, mcp, tools (got "${target}")`,
					);
					actionExitCode = 1;
			}
		})
		.hook("postAction", () => {
			if (typeof actionExitCode === "number") {
				setExitCode(actionExitCode);
			}
		});

	return config;
}
