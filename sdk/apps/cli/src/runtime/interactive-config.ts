import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import {
	ALL_DEFAULT_TOOL_NAMES,
	createAgentConfigWatcher,
	discoverPluginModulePaths,
	hasMcpSettingsFile,
	listHookConfigFiles,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
	resolvePluginConfigSearchPaths,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";

export type InteractiveConfigTab =
	| "tools"
	| "agents"
	| "plugins"
	| "hooks"
	| "skills"
	| "rules"
	| "mcp";

export interface InteractiveConfigItem {
	id: string;
	name: string;
	path: string;
	enabled?: boolean;
	source: "global" | "workspace";
	description?: string;
}

export interface InteractiveConfigData {
	workflows: InteractiveConfigItem[];
	rules: InteractiveConfigItem[];
	skills: InteractiveConfigItem[];
	hooks: InteractiveConfigItem[];
	agents: InteractiveConfigItem[];
	plugins: InteractiveConfigItem[];
	mcp: InteractiveConfigItem[];
	tools: InteractiveConfigItem[];
}

function detectSource(
	path: string,
	workspaceRoot: string,
): "global" | "workspace" {
	if (!workspaceRoot) {
		return "global";
	}
	return path.startsWith(workspaceRoot) ? "workspace" : "global";
}

function toSorted<T extends InteractiveConfigItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		if (a.source !== b.source) {
			return a.source === "workspace" ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

export async function loadInteractiveConfigData(input: {
	watcher?: UserInstructionConfigWatcher;
	cwd: string;
	workspaceRoot: string;
}): Promise<InteractiveConfigData> {
	const workflows: InteractiveConfigItem[] = [];
	const rules: InteractiveConfigItem[] = [];
	const skills: InteractiveConfigItem[] = [];
	const hooks: InteractiveConfigItem[] = [];
	const agents: InteractiveConfigItem[] = [];
	const plugins: InteractiveConfigItem[] = [];
	const mcp: InteractiveConfigItem[] = [];
	const tools: InteractiveConfigItem[] = [];

	if (input.watcher) {
		for (const [id, record] of input.watcher
			.getSnapshot("workflow")
			.entries()) {
			const workflow = record.item;
			workflows.push({
				id,
				name: workflow.name,
				path: record.filePath,
				enabled: workflow.disabled !== true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: workflow.instructions,
			});
		}
		for (const [id, record] of input.watcher.getSnapshot("rule").entries()) {
			const rule = record.item;
			rules.push({
				id,
				name: rule.name,
				path: record.filePath,
				enabled: rule.disabled !== true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: rule.instructions,
			});
		}
		for (const [id, record] of input.watcher.getSnapshot("skill").entries()) {
			const skill = record.item as {
				name: string;
				disabled?: boolean;
				description?: string;
			};
			skills.push({
				id,
				name: skill.name,
				path: record.filePath,
				enabled: skill.disabled !== true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: skill.description,
			});
		}
	}

	for (const hook of listHookConfigFiles(input.cwd)) {
		hooks.push({
			id: hook.path,
			name: hook.fileName,
			path: hook.path,
			enabled: true,
			source: detectSource(hook.path, input.workspaceRoot),
			description: hook.hookEventName,
		});
	}

	const agentWatcher = createAgentConfigWatcher();
	try {
		await agentWatcher.start();
		for (const [id, record] of agentWatcher.getSnapshot("agent").entries()) {
			const agent = record.item;
			agents.push({
				id,
				name: agent.name,
				path: record.filePath,
				enabled: true,
				source: detectSource(record.filePath, input.workspaceRoot),
				description: agent.description,
			});
		}
	} catch {
		// Best effort: keep agents empty when watcher initialization fails.
	} finally {
		agentWatcher.stop();
	}

	const pluginDirectories = resolvePluginConfigSearchPaths(
		input.workspaceRoot,
	).filter((directory) => existsSync(directory));
	for (const directory of pluginDirectories) {
		for (const filePath of discoverPluginModulePaths(directory)) {
			plugins.push({
				id: filePath,
				name: basename(filePath, extname(filePath)),
				path: filePath,
				enabled: true,
				source: detectSource(filePath, input.workspaceRoot),
			});
		}
	}

	const mcpSettingsPath = resolveDefaultMcpSettingsPath();
	if (hasMcpSettingsFile({ filePath: mcpSettingsPath })) {
		try {
			for (const registration of resolveMcpServerRegistrations({
				filePath: mcpSettingsPath,
			})) {
				mcp.push({
					id: registration.name,
					name: registration.name,
					path: mcpSettingsPath,
					enabled: registration.disabled !== true,
					source: detectSource(mcpSettingsPath, input.workspaceRoot),
					description: registration.transport.type,
				});
			}
		} catch {
			// Best effort: keep MCP list empty on parse/load errors.
		}
	}

	for (const toolName of [...ALL_DEFAULT_TOOL_NAMES, "submit_and_exit"]) {
		tools.push({
			id: toolName,
			name: toolName,
			path: "(builtin)",
			enabled: true,
			source: "global",
		});
	}

	return {
		workflows: toSorted(workflows.filter((item) => existsSync(item.path))),
		rules: toSorted(rules.filter((item) => existsSync(item.path))),
		skills: toSorted(skills.filter((item) => existsSync(item.path))),
		hooks: toSorted(hooks.filter((item) => existsSync(item.path))),
		agents: toSorted(agents.filter((item) => existsSync(item.path))),
		plugins: toSorted(plugins.filter((item) => existsSync(item.path))),
		mcp: toSorted(mcp.filter((item) => existsSync(item.path))),
		tools: toSorted(tools),
	};
}
