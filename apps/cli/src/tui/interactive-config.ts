import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	type BuiltinToolAvailabilityContext,
	discoverPluginModulePaths,
	hasMcpSettingsFile,
	listHookConfigFiles,
	listPluginToolsWithDiagnostics,
	type McpServerRegistration,
	type PluginInitializationFailure,
	type RuleConfig,
	readGlobalSettings,
	resolveAgentConfigSearchPaths,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
	resolvePluginConfigSearchPaths,
	resolvePluginSkillDirectoriesFromPaths,
	type SkillConfig,
	type UserInstructionConfigService,
	type WorkflowConfig,
} from "@cline/core";
import { getToolCatalog } from "../runtime/tools";
import {
	type InteractiveSlashCommand,
	listInteractiveSlashCommands,
} from "./interactive-welcome";

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
	enabledState?: "enabled" | "disabled" | "partial";
	toolNames?: string[];
	configKind?: "tool" | "plugin" | "plugin-mcp";
	pluginName?: string;
	pluginPath?: string;
	mcpServerName?: string;
	loadError?: string;
	loadErrorPhase?: PluginInitializationFailure["phase"];
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
	workflowSlashCommands: InteractiveSlashCommand[];
	pluginDiagnosticsLoaded?: boolean;
}

export interface LoadInteractiveConfigDataOptions {
	includePluginTools?: boolean;
}

export function isToggleableInteractiveConfigItem(
	item: Pick<InteractiveConfigItem, "kind" | "source" | "pluginName">,
): boolean {
	if (item.kind === "mcp") {
		return !item.pluginName;
	}
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

function detectPluginSource(
	path: string,
	workspaceRoot: string,
): "global-plugin" | "workspace-plugin" {
	return detectSource(path, workspaceRoot) === "workspace"
		? "workspace-plugin"
		: "global-plugin";
}

function toSorted<T extends InteractiveConfigItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		const sourceRank = (source: InteractiveConfigItem["source"]): number => {
			switch (source) {
				case "builtin":
					return 0;
				case "workspace":
					return 1;
				case "workspace-plugin":
					return 2;
				case "global":
					return 3;
				case "global-plugin":
					return 4;
			}
		};
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

function getMcpAuthLabel(registration: McpServerRegistration): string {
	if (registration.transport.type === "stdio") {
		return "local";
	}
	if (registration.oauth?.lastError) {
		return "oauth error";
	}
	const accessToken = registration.oauth?.tokens?.access_token;
	if (typeof accessToken === "string" && accessToken.trim().length > 0) {
		return "oauth authorized";
	}
	if (registration.oauth && Object.keys(registration.oauth).length > 0) {
		return "oauth pending";
	}
	if (
		registration.transport.headers &&
		Object.keys(registration.transport.headers).length > 0
	) {
		return "static headers";
	}
	return "no auth";
}

function getMcpDescription(registration: McpServerRegistration): string {
	return `${registration.transport.type}, ${getMcpAuthLabel(registration)}`;
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

function readPackageName(packageJsonPath: string): string | undefined {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			name?: unknown;
		};
		return typeof packageJson.name === "string" && packageJson.name.trim()
			? packageJson.name.trim()
			: undefined;
	} catch {
		return undefined;
	}
}

function getPluginDisplayName(filePath: string, searchRoot: string): string {
	let current = dirname(filePath);
	const root = resolve(searchRoot);
	while (isPathWithin(root, current)) {
		const packageJsonPath = join(current, "package.json");
		if (existsSync(packageJsonPath)) {
			const packageName = readPackageName(packageJsonPath);
			if (packageName) {
				return packageName;
			}
			break;
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return basename(filePath, extname(filePath));
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

type PluginSkillOwner = {
	directory: string;
	pluginName: string;
	pluginPath: string;
	source: "global-plugin" | "workspace-plugin";
};

function buildPluginSkillOwners(
	plugins: readonly InteractiveConfigItem[],
): PluginSkillOwner[] {
	const owners: PluginSkillOwner[] = [];
	for (const plugin of plugins) {
		if (
			plugin.kind !== "plugin" ||
			(plugin.source !== "workspace-plugin" &&
				plugin.source !== "global-plugin")
		) {
			continue;
		}
		for (const directory of resolvePluginSkillDirectoriesFromPaths([
			plugin.path,
		])) {
			owners.push({
				directory,
				pluginName: plugin.name,
				pluginPath: plugin.path,
				source: plugin.source,
			});
		}
	}
	return owners.sort(
		(left, right) => right.directory.length - left.directory.length,
	);
}

function findPluginSkillOwner(
	filePath: string,
	owners: readonly PluginSkillOwner[],
): PluginSkillOwner | undefined {
	return owners.find((owner) => isPathWithin(owner.directory, filePath));
}

function formatPluginFailure(failure: PluginInitializationFailure): string {
	return `${failure.phase === "setup" ? "setup failed" : "load failed"}: ${failure.message}`;
}

export function applyPluginFailures(
	plugins: InteractiveConfigItem[],
	failures: readonly PluginInitializationFailure[],
): void {
	const pluginsByPath = new Map(plugins.map((plugin) => [plugin.path, plugin]));
	const failuresByPath = new Map<string, PluginInitializationFailure[]>();
	for (const failure of failures) {
		const failuresForPath = failuresByPath.get(failure.pluginPath) ?? [];
		failuresForPath.push(failure);
		failuresByPath.set(failure.pluginPath, failuresForPath);
	}
	for (const [pluginPath, failuresForPath] of failuresByPath) {
		const plugin = pluginsByPath.get(pluginPath);
		if (!plugin) {
			continue;
		}
		const namedFailure = failuresForPath.find((failure) => failure.pluginName);
		if (namedFailure?.pluginName) {
			plugin.name = namedFailure.pluginName;
		}
		plugin.loadError = failuresForPath.map(formatPluginFailure).join("\n");
		plugin.loadErrorPhase =
			failuresForPath.length === 1 ? failuresForPath[0]?.phase : undefined;
	}
}

export async function loadInteractiveConfigData(input: {
	userInstructionService?: UserInstructionConfigService;
	cwd: string;
	workspaceRoot: string;
	availabilityContext?: BuiltinToolAvailabilityContext;
	includePluginTools?: boolean;
}): Promise<InteractiveConfigData> {
	const workflows: InteractiveConfigItem[] = [];
	const rules: InteractiveConfigItem[] = [];
	const skills: InteractiveConfigItem[] = [];
	const hooks: InteractiveConfigItem[] = [];
	const agents: InteractiveConfigItem[] = [];
	const plugins: InteractiveConfigItem[] = [];
	const mcp: InteractiveConfigItem[] = [];
	const tools: InteractiveConfigItem[] = [];
	const workflowSlashCommands = listInteractiveSlashCommands(
		input.userInstructionService,
	);

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
					name: getPluginDisplayName(filePath, directory),
					path: filePath,
					enabled: !disabledPlugins.has(filePath),
					kind: "plugin",
					configKind: "plugin",
					source: detectPluginSource(filePath, input.workspaceRoot),
				});
			}
		} catch {
			// Best effort: skip unreadable plugin roots.
		}
	}

	const pluginSkillOwners = buildPluginSkillOwners(plugins);

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
			const pluginOwner = findPluginSkillOwner(
				record.filePath,
				pluginSkillOwners,
			);
			skills.push({
				id: record.id,
				name: skill.name,
				path: record.filePath,
				enabled: skill.disabled !== true,
				kind: "skill",
				source:
					pluginOwner?.source ??
					detectSource(record.filePath, input.workspaceRoot),
				description: skill.description,
				pluginName: pluginOwner?.pluginName,
				pluginPath: pluginOwner?.pluginPath,
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
					kind: "mcp",
					source: detectSource(mcpSettingsPath, input.workspaceRoot),
					description: getMcpDescription(registration),
					loadError: registration.oauth?.lastError,
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
			enabledState: tool.defaultEnabled
				? ("enabled" as const)
				: ("disabled" as const),
			kind: "tool" as const,
			toolNames: [tool.id, ...tool.headlessToolNames],
			configKind: "tool" as const,
			source: "builtin" as const,
			description: tool.description,
		})),
	);
	if (input.includePluginTools !== false) {
		try {
			const pluginToolResult = await listPluginToolsWithDiagnostics({
				workspacePath: input.workspaceRoot,
				cwd: input.cwd,
				providerId: input.availabilityContext?.providerId,
				modelId: input.availabilityContext?.modelId,
			});
			applyPluginFailures(plugins, pluginToolResult.failures);
			for (const pluginMcpServer of pluginToolResult.mcpServers) {
				mcp.push({
					id: `${pluginMcpServer.pluginName}:${pluginMcpServer.name}:${pluginMcpServer.path}`,
					name: pluginMcpServer.name,
					path: pluginMcpServer.path,
					enabled: pluginMcpServer.enabled,
					enabledState: pluginMcpServer.enabled ? "enabled" : "disabled",
					kind: "mcp" as const,
					configKind: "plugin-mcp",
					pluginName: pluginMcpServer.pluginName,
					pluginPath: pluginMcpServer.path,
					source: pluginMcpServer.source,
					description: `plugin MCP configured - ${pluginMcpServer.description ?? "server"}; disable plugin to disable server`,
					loadError: pluginMcpServer.loadError,
				});
			}
			for (const pluginTool of pluginToolResult.tools) {
				tools.push({
					id: `${pluginTool.pluginName}:${pluginTool.name}:${pluginTool.path}`,
					name: pluginTool.name,
					path: pluginTool.path,
					enabled: pluginTool.enabled,
					enabledState: pluginTool.enabled ? "enabled" : "disabled",
					kind: "tool" as const,
					toolNames: [pluginTool.name],
					configKind: "tool",
					pluginName: pluginTool.pluginName,
					pluginPath: pluginTool.path,
					mcpServerName: pluginTool.mcpServerName,
					source: pluginTool.source,
					description: pluginTool.description,
				});
			}
		} catch {
			// Best effort: built-in tools and instruction config should still render.
		}
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
		workflowSlashCommands,
		pluginDiagnosticsLoaded: input.includePluginTools !== false,
	};
}
