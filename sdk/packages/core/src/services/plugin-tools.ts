import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { PluginErrorRecord, PluginRuntimeState } from "@cline/shared";
import { resolveAgentPluginPathsWithDiagnostics } from "../extensions/plugin/plugin-config-loader";
import { collectPluginContributions } from "../extensions/plugin/plugin-contributions";
import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";
import { resolveDisabledToolNames } from "./global-settings";

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
	/** Runtime state; `failed` plugins are listed with empty contributions. */
	state: PluginRuntimeState;
	lastError?: PluginErrorRecord;
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

export async function listPluginToolsWithDiagnostics(input: {
	workspacePath: string;
	cwd?: string;
	disabledToolNames?: ReadonlyArray<string>;
	providerId?: string;
	modelId?: string;
}): Promise<ListPluginToolsResult> {
	const resolved = resolveAgentPluginPathsWithDiagnostics({
		workspacePath: input.workspacePath,
		cwd: input.cwd,
	});
	const pluginPaths = resolved.paths;
	const disabled = resolveDisabledToolNames(input.disabledToolNames);
	if (pluginPaths.length === 0 && resolved.discoveryFailures.length === 0) {
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
	const collected = await collectPluginContributions({
		pluginPaths,
		discoveryFailures: resolved.discoveryFailures,
		cwd: input.cwd,
		workspacePath: input.workspacePath,
		providerId: input.providerId,
		modelId: input.modelId,
	});
	for (const contribution of collected.plugins) {
		const { extension, pluginPath } = contribution;
		const pluginSource = isPathWithin(input.workspacePath, pluginPath)
			? "workspace-plugin"
			: "global-plugin";
		for (const tool of contribution.tools) {
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
			tools: contribution.tools.map((tool) => tool.name).sort(),
			rules: contribution.rules.map((rule) => rule.id).sort(),
			hooks: Object.keys(extension.hooks ?? {}).sort(),
			commands: contribution.commands.map((command) => command.name).sort(),
			mcpServers: contribution.mcpServers.map((server) => server.name).sort(),
			providers: contribution.providers.map((provider) => provider.name).sort(),
			state: "ready",
		});
	}
	// Failed plugins stay in the list so settings surfaces can show why a
	// plugin's tools are missing instead of silently leaving it out.
	for (const status of collected.failed) {
		plugins.push({
			pluginName: status.name,
			path: status.pluginPath,
			capabilities: status.capabilities ?? [],
			tools: [],
			rules: [],
			hooks: [],
			commands: [],
			mcpServers: [],
			providers: [],
			state: status.state,
			...(status.lastError ? { lastError: status.lastError } : {}),
		});
	}

	const sortedTools = sortPluginToolDescriptors(tools);
	const entry = {
		tools: sortedTools,
		plugins,
		failures: collected.failures,
		warnings: collected.warnings,
	};
	// A failed plugin may be fixed without touching the files the key
	// fingerprints (a missing dependency installed), so only cache clean runs.
	if (collected.failures.length === 0) {
		cachePluginToolDescriptors(cacheKey, entry);
	}
	return {
		tools: withEnabledState(sortedTools, disabled),
		plugins,
		failures: collected.failures,
		warnings: collected.warnings,
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
