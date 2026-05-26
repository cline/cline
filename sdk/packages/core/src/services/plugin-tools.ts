import { stat } from "node:fs/promises";
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
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
}

type PluginToolDescriptor = Omit<PluginToolSummary, "enabled">;
type PluginToolDescriptorCacheEntry = {
	tools: PluginToolDescriptor[];
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

function collectRegisteredTools(
	extension: AgentExtension,
	workspaceInfo?: { rootPath: string },
): AgentTool[] {
	if (!extension.setup) {
		return [];
	}

	const tools: AgentTool[] = [];
	const api: AgentExtensionApi = {
		registerTool: (tool) => tools.push(tool),
		registerCommand: () => {},
		registerMessageBuilder: () => {},
		registerRule: () => {},
		registerProvider: () => {},
		registerAutomationEventType: () => {},
	};
	extension.setup(api, { workspaceInfo });
	return tools;
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
		return { tools: [], failures: [], warnings: [] };
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
			failures: cached.failures,
			warnings: cached.warnings,
		};
	}

	const tools: PluginToolDescriptor[] = [];
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
			for (const tool of collectRegisteredTools(extension, {
				rootPath: input.workspacePath,
			})) {
				tools.push({
					name: tool.name,
					pluginName: extension.name,
					path: pluginPath,
					source: pluginPath.startsWith(input.workspacePath)
						? "workspace-plugin"
						: "global-plugin",
					description: tool.description?.trim() || undefined,
				});
			}
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
	const cacheEntry = {
		tools: sortedTools,
		failures,
		warnings,
	};
	cachePluginToolDescriptors(cacheKey, cacheEntry);
	return {
		tools: withEnabledState(sortedTools, disabled),
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
