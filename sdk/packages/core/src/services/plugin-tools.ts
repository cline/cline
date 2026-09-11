import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AgentConfig, AgentTool } from "@cline/shared";
import { resolveAgentPluginPaths } from "../extensions/plugin/plugin-config-loader";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";
import { loadSandboxedPlugins } from "../extensions/plugin/plugin-sandbox";
import { resolveDisabledToolNames } from "./global-settings";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];
type AgentExtensionWithPath = AgentExtension & { __clinePluginPath?: string };

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

export interface PluginToolSummary {
	name: string;
	pluginName: string;
	path: string;
	source: "workspace-plugin" | "global-plugin";
	enabled: boolean;
	description?: string;
}

export interface ListPluginToolsResult {
	tools: PluginToolSummary[];
	plugins: PluginContributionSummary[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

export interface PluginContributionSummary {
	pluginName: string;
	path: string;
	capabilities: string[];
	tools: string[];
	rules: string[];
	hooks: string[];
	commands: string[];
	mcpServers: string[];
	providers: string[];
}

type PluginToolDescriptor = Omit<PluginToolSummary, "enabled">;
type PluginToolDescriptorCacheEntry = {
	tools: PluginToolDescriptor[];
	plugins: PluginContributionSummary[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
};

const MAX_PLUGIN_TOOL_DESCRIPTOR_CACHE_ENTRIES = 32;
const pluginToolDescriptorCache = new Map<
	string,
	PluginToolDescriptorCacheEntry
>();

function cachePluginToolDescriptors(
	key: string,
	entry: PluginToolDescriptorCacheEntry,
): void {
	if (
		!pluginToolDescriptorCache.has(key) &&
		pluginToolDescriptorCache.size >= MAX_PLUGIN_TOOL_DESCRIPTOR_CACHE_ENTRIES
	) {
		const oldestKey = pluginToolDescriptorCache.keys().next().value;
		if (oldestKey) {
			pluginToolDescriptorCache.delete(oldestKey);
		}
	}
	pluginToolDescriptorCache.set(key, entry);
}

async function buildPluginToolDescriptorCacheKey(input: {
	pluginPaths: ReadonlyArray<string>;
	workspacePath: string;
	cwd?: string;
	providerId?: string;
	modelId?: string;
}): Promise<string> {
	const pathStats = await Promise.all(
		input.pluginPaths.map(async (pluginPath) => {
			try {
				const stats = await stat(pluginPath);
				return `${pluginPath}:${stats.mtimeMs}:${stats.size}`;
			} catch {
				return `${pluginPath}:missing`;
			}
		}),
	);
	return JSON.stringify({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
		providerId: input.providerId,
		modelId: input.modelId,
		pathStats,
	});
}

function withEnabledState(
	tools: readonly PluginToolDescriptor[],
	disabled: ReadonlySet<string>,
): PluginToolSummary[] {
	return tools.map((tool) => ({
		...tool,
		enabled: !disabled.has(tool.name),
	}));
}

function sortPluginToolDescriptors(
	tools: PluginToolDescriptor[],
): PluginToolDescriptor[] {
	return tools.sort((left, right) => {
		const nameOrder = left.name.localeCompare(right.name);
		if (nameOrder !== 0) {
			return nameOrder;
		}
		return left.path.localeCompare(right.path);
	});
}

async function collectPluginContributions(
	extension: AgentExtension,
	workspaceInfo?: { rootPath: string },
): Promise<{
	tools: AgentTool[];
	rules: Array<Parameters<AgentExtensionApi["registerRule"]>[0]>;
	commands: Array<Parameters<AgentExtensionApi["registerCommand"]>[0]>;
	mcpServers: Array<Parameters<AgentExtensionApi["registerMcpServer"]>[0]>;
	providers: Array<Parameters<AgentExtensionApi["registerProvider"]>[0]>;
}> {
	if (!extension.setup) {
		return {
			tools: [],
			rules: [],
			commands: [],
			mcpServers: [],
			providers: [],
		};
	}

	const tools: AgentTool[] = [];
	const rules: Array<Parameters<AgentExtensionApi["registerRule"]>[0]> = [];
	const commands: Array<Parameters<AgentExtensionApi["registerCommand"]>[0]> =
		[];
	const mcpServers: Array<
		Parameters<AgentExtensionApi["registerMcpServer"]>[0]
	> = [];
	const providers: Array<Parameters<AgentExtensionApi["registerProvider"]>[0]> =
		[];
	const api: AgentExtensionApi = {
		registerTool: (tool) => tools.push(tool),
		registerCommand: (command) => commands.push(command),
		registerMessageBuilder: () => {},
		registerRule: (rule) => rules.push(rule),
		registerProvider: (provider) => providers.push(provider),
		registerAutomationEventType: () => {},
		registerMcpServer: (server) => {
			if (!extension.manifest.capabilities.includes("mcp")) {
				throw new Error('registerMcpServer requires the "mcp" capability');
			}
			mcpServers.push(server);
		},
	};
	await extension.setup(api, { workspaceInfo });
	return { tools, rules, commands, mcpServers, providers };
}

export async function listPluginToolsWithDiagnostics(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<ListPluginToolsResult> {
	const pluginPaths = resolveAgentPluginPaths({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
	});
	const disabled = resolveDisabledToolNames(input.disabledToolNames);
	if (pluginPaths.length === 0) {
		return { tools: [], plugins: [], failures: [], warnings: [] };
	}

	const cacheKey = await buildPluginToolDescriptorCacheKey({
		pluginPaths,
		workspacePath: input.workspacePath,
		cwd: input.cwd,
		providerId: input.providerId,
		modelId: input.modelId,
	});
	const cached = pluginToolDescriptorCache.get(cacheKey);
	if (cached) {
		return {
			tools: withEnabledState(cached.tools, disabled),
			plugins: cached.plugins,
			failures: cached.failures,
			warnings: cached.warnings,
		};
	}

	const tools: PluginToolDescriptor[] = [];
	const plugins: PluginContributionSummary[] = [];
	let failures: PluginInitializationFailure[] = [];
	let warnings: PluginInitializationWarning[] = [];
	let sandboxed: Awaited<ReturnType<typeof loadSandboxedPlugins>> | undefined;

	try {
		sandboxed = await loadSandboxedPlugins({
			pluginPaths,
			cwd: input.cwd,
			providerId: input.providerId,
			modelId: input.modelId,
			workspaceInfo: { rootPath: input.workspacePath },
		});
		failures = [...sandboxed.failures];
		warnings = [...sandboxed.warnings];
		for (const extension of sandboxed.extensions ?? []) {
			const pluginPath = (extension as AgentExtensionWithPath)
				.__clinePluginPath;
			if (!pluginPath) {
				continue;
			}
			const pluginSource = isPathWithin(input.workspacePath, pluginPath)
				? "workspace-plugin"
				: "global-plugin";
			let contributions: Awaited<ReturnType<typeof collectPluginContributions>>;
			try {
				contributions = await collectPluginContributions(extension, {
					rootPath: input.workspacePath,
				});
			} catch (error) {
				failures.push({
					pluginPath,
					pluginName: extension.name,
					phase: "setup",
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
				continue;
			}
			for (const tool of contributions.tools) {
				tools.push({
					name: tool.name,
					pluginName: extension.name,
					path: pluginPath,
					source: pluginSource,
					description: tool.description?.trim() || undefined,
				});
			}
			plugins.push({
				pluginName: extension.name,
				path: pluginPath,
				capabilities: [...extension.manifest.capabilities].sort(),
				tools: contributions.tools.map((tool) => tool.name).sort(),
				rules: contributions.rules.map((rule) => rule.id).sort(),
				hooks: Object.keys(extension.hooks ?? {}).sort(),
				commands: contributions.commands.map((command) => command.name).sort(),
				mcpServers: contributions.mcpServers
					.map((server) => server.name)
					.sort(),
				providers: contributions.providers
					.map((provider) => provider.name)
					.sort(),
			});
		}
	} catch (error) {
		failures = pluginPaths.map((pluginPath) => ({
			pluginPath,
			phase: "load" as const,
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		}));
	} finally {
		await sandboxed?.shutdown().catch(() => {
			// Best effort cleanup after contribution discovery.
		});
	}

	const sortedTools = sortPluginToolDescriptors(tools);
	cachePluginToolDescriptors(cacheKey, {
		tools: sortedTools,
		plugins,
		failures,
		warnings,
	});
	return {
		tools: withEnabledState(sortedTools, disabled),
		plugins,
		failures,
		warnings,
	};
}

export async function listPluginTools(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<PluginToolSummary[]> {
	return (await listPluginToolsWithDiagnostics(input)).tools;
}
