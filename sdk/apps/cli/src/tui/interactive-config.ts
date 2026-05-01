import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
	type BuiltinToolAvailabilityContext,
	discoverPluginModulePaths,
	hasMcpSettingsFile,
	listHookConfigFiles,
	listPluginTools,
	type RuleConfig,
	readGlobalSettings,
	resolveAgentConfigSearchPaths,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
	resolvePluginConfigSearchPaths,
	type SkillConfig,
	type UserInstructionConfigService,
	type WorkflowConfig,
} from "@clinebot/core";
import { getToolCatalog } from "../runtime/tools";

export type InteractiveConfigTab =
	| "general"
	| "tools"
	| "workflows"
	| "agents"
	| "plugins"
	| "hooks"
	| "skills"
	| "rules"
	| "mcp";

export type InteractiveConfigItemKind =
	| "workflow"
	| "rule"
	| "skill"
	| "hook"
	| "agent"
	| "plugin"
	| "mcp"
	| "tool";

export interface InteractiveConfigItem {
	id: string;
	name: string;
	path: string;
	enabled?: boolean;
	kind: InteractiveConfigItemKind;
	toolNames?: string[];
	source:
		| "global"
		| "workspace"
		| "builtin"
		| "global-plugin"
		| "workspace-plugin";
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

export function isToggleableInteractiveConfigItem(
	item: Pick<InteractiveConfigItem, "kind" | "source">,
): boolean {
	return (
		item.kind === "skill" ||
		item.kind === "plugin" ||
		item.source === "builtin" ||
		item.source === "workspace-plugin" ||
		item.source === "global-plugin"
	);
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
		const sourceRank = (source: InteractiveConfigItem["source"]): number => {
			switch (source) {
				case "workspace":
				case "workspace-plugin":
					return 0;
				case "global":
				case "global-plugin":
					return 1;
				case "builtin":
					return 2;
			}
		};
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

function loadAgentConfigItems(workspaceRoot: string): InteractiveConfigItem[] {
	const agentsById = new Map<string, InteractiveConfigItem>();
	const directories = resolveAgentConfigSearchPaths(workspaceRoot).filter(
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
				const descriptionMatch = frontmatter.match(
					/^\s*description:\s*(.+?)\s*$/m,
				);
				const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
				const parsedDescription = descriptionMatch?.[1]
					?.replace(/^["']|["']$/g, "")
					.trim();
				const name =
					parsedName && parsedName.length > 0
						? parsedName
						: basename(entry.name, extension);
				const id = name.toLowerCase();
				if (agentsById.has(id)) {
					continue;
				}
				agentsById.set(id, {
					id,
					name,
					path: filePath,
					enabled: true,
					kind: "agent",
					source: detectSource(filePath, workspaceRoot),
					description: parsedDescription,
				});
			}
		} catch {
			// Best effort: keep listing other agent config roots.
		}
	}

	return [...agentsById.values()];
}

export async function loadInteractiveConfigData(input: {
	userInstructionService?: UserInstructionConfigService;
	cwd: string;
	workspaceRoot: string;
	availabilityContext?: BuiltinToolAvailabilityContext;
}): Promise<InteractiveConfigData> {
	const workflows: InteractiveConfigItem[] = [];
	const rules: InteractiveConfigItem[] = [];
	const skills: InteractiveConfigItem[] = [];
	const hooks: InteractiveConfigItem[] = [];
	const agents: InteractiveConfigItem[] = [];
	const plugins: InteractiveConfigItem[] = [];
	const mcp: InteractiveConfigItem[] = [];
	const tools: InteractiveConfigItem[] = [];

	if (input.userInstructionService) {
		for (const record of input.userInstructionService.listRecords<WorkflowConfig>(
			"workflow",
		)) {
			const workflow = record.item;
			workflows.push({
				id: record.id,
				name: workflow.name,
				path: record.filePath,
				enabled: workflow.disabled !== true,
				kind: "workflow",
				source: detectSource(record.filePath, input.workspaceRoot),
				description: workflow.instructions,
			});
		}
		for (const record of input.userInstructionService.listRecords<RuleConfig>(
			"rule",
		)) {
			const rule = record.item;
			rules.push({
				id: record.id,
				name: rule.name,
				path: record.filePath,
				enabled: rule.disabled !== true,
				kind: "rule",
				source: detectSource(record.filePath, input.workspaceRoot),
				description: rule.instructions,
			});
		}
		for (const record of input.userInstructionService.listRecords<SkillConfig>(
			"skill",
		)) {
			const skill = record.item;
			skills.push({
				id: record.id,
				name: skill.name,
				path: record.filePath,
				enabled: skill.disabled !== true,
				kind: "skill",
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
			kind: "hook",
			source: detectSource(hook.path, input.workspaceRoot),
			description: hook.hookEventName,
		});
	}

	agents.push(...loadAgentConfigItems(input.workspaceRoot));

	const disabledPlugins = new Set(readGlobalSettings().disabledPlugins ?? []);
	const pluginDirectories = resolvePluginConfigSearchPaths(
		input.workspaceRoot,
	).filter((directory) => existsSync(directory));
	for (const directory of pluginDirectories) {
		try {
			for (const filePath of discoverPluginModulePaths(directory)) {
				plugins.push({
					id: filePath,
					name: basename(filePath, extname(filePath)),
					path: filePath,
					enabled: !disabledPlugins.has(filePath),
					kind: "plugin",
					source: detectSource(filePath, input.workspaceRoot),
				});
			}
		} catch {
			// Best effort: skip unreadable plugin roots.
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
					kind: "mcp",
					source: detectSource(mcpSettingsPath, input.workspaceRoot),
					description: registration.transport.type,
				});
			}
		} catch {
			// Best effort: keep MCP list empty on parse/load errors.
		}
	}

	tools.push(
		...getToolCatalog(input.availabilityContext).map((tool) => ({
			id: tool.id,
			name: tool.id,
			path:
				tool.headlessToolNames.length === 1 &&
				tool.headlessToolNames[0] === tool.id
					? tool.id
					: tool.headlessToolNames.join(", "),
			enabled: tool.defaultEnabled,
			kind: "tool" as const,
			toolNames: [tool.id, ...tool.headlessToolNames],
			source: "builtin" as const,
			description: tool.description,
		})),
	);
	try {
		for (const pluginTool of await listPluginTools({
			workspacePath: input.workspaceRoot,
			cwd: input.cwd,
			providerId: input.availabilityContext?.providerId,
			modelId: input.availabilityContext?.modelId,
		})) {
			tools.push({
				id: `${pluginTool.pluginName}:${pluginTool.name}:${pluginTool.path}`,
				name: pluginTool.name,
				path: pluginTool.path,
				enabled: pluginTool.enabled,
				kind: "tool" as const,
				toolNames: [pluginTool.name],
				source: pluginTool.source,
				description: pluginTool.description,
			});
		}
	} catch {
		// Best effort: built-in tools and instruction config should still render.
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
