import { statSync } from "node:fs";
import type { AgentConfig, AgentTool } from "@cline/shared";
import { resolveAgentPluginPaths } from "../extensions/plugin/plugin-config-loader";
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

type PluginToolDescriptor = Omit<PluginToolSummary, "enabled">;

const MAX_PLUGIN_TOOL_DESCRIPTOR_CACHE_ENTRIES = 32;
const pluginToolDescriptorCache = new Map<string, PluginToolDescriptor[]>();

function cachePluginToolDescriptors(
	key: string,
	descriptors: PluginToolDescriptor[],
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
	pluginToolDescriptorCache.set(key, descriptors);
}

function buildPluginToolDescriptorCacheKey(input: {
	pluginPaths: ReadonlyArray<string>;
	workspacePath: string;
	cwd?: string;
	providerId?: string;
	modelId?: string;
}): string {
	const pathStats = input.pluginPaths.map((pluginPath) => {
		try {
			const stats = statSync(pluginPath);
			return `${pluginPath}:${stats.mtimeMs}:${stats.size}`;
		} catch {
			return `${pluginPath}:missing`;
		}
	});
	return JSON.stringify({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
		providerId: input.providerId,
		modelId: input.modelId,
		pathStats,
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

export async function listPluginTools(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<PluginToolSummary[]> {
	const pluginPaths = resolveAgentPluginPaths({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
	});
	if (pluginPaths.length === 0) {
		return [];
	}
	const disabled = resolveDisabledToolNames(input.disabledToolNames);
	const cacheKey = buildPluginToolDescriptorCacheKey({
		pluginPaths,
		workspacePath: input.workspacePath,
		cwd: input.cwd,
		providerId: input.providerId,
		modelId: input.modelId,
	});
	const cached = pluginToolDescriptorCache.get(cacheKey);
	if (cached) {
		return cached.map((tool) => ({
			...tool,
			enabled: !disabled.has(tool.name),
		}));
	}
	const descriptors: PluginToolDescriptor[] = [];

	let sandboxed: Awaited<ReturnType<typeof loadSandboxedPlugins>> | undefined;
	try {
		sandboxed = await loadSandboxedPlugins({
			pluginPaths,
			cwd: input.cwd,
			providerId: input.providerId,
			modelId: input.modelId,
			workspaceInfo: { rootPath: input.workspacePath },
		});
		for (const extension of sandboxed.extensions ?? []) {
			const pluginPath = (extension as AgentExtensionWithPath)
				.__clinePluginPath;
			if (!pluginPath) {
				continue;
			}
			for (const tool of collectRegisteredTools(extension, {
				rootPath: input.workspacePath,
			})) {
				descriptors.push({
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
	} catch {
		// Tool listing is best effort so settings can still render built-in tools
		// if plugin initialization fails.
	} finally {
		await sandboxed?.shutdown().catch(() => {
			// Best effort cleanup after contribution discovery.
		});
	}

	const sortedDescriptors = descriptors.sort((left, right) => {
		const nameOrder = left.name.localeCompare(right.name);
		if (nameOrder !== 0) {
			return nameOrder;
		}
		return left.path.localeCompare(right.path);
	});
	cachePluginToolDescriptors(cacheKey, sortedDescriptors);
	return sortedDescriptors.map((tool) => ({
		...tool,
		enabled: !disabled.has(tool.name),
	}));
}
