import { existsSync } from "node:fs";
import type { AgentConfig } from "@clinebot/shared";
import {
	discoverPluginModulePaths as discoverPluginModulePathsFromShared,
	resolveConfiguredPluginModulePaths,
	resolvePluginConfigSearchPaths as resolvePluginConfigSearchPathsFromShared,
} from "@clinebot/shared/storage";
import { loadAgentPluginsFromPaths } from "./plugin-loader";
import { loadSandboxedPlugins } from "./plugin-sandbox";

type AgentPlugin = NonNullable<AgentConfig["extensions"]>[number];

export function resolvePluginConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolvePluginConfigSearchPathsFromShared(workspacePath);
}

export function discoverPluginModulePaths(directoryPath: string): string[] {
	return discoverPluginModulePathsFromShared(directoryPath);
}

export interface ResolveAgentPluginPathsOptions {
	pluginPaths?: ReadonlyArray<string>;
	workspacePath?: string;
	cwd?: string;
}

export function resolveAgentPluginPaths(
	options: ResolveAgentPluginPathsOptions = {},
): string[] {
	const cwd = options.cwd ?? process.cwd();
	const discoveredFromSearchPaths = resolvePluginConfigSearchPaths(
		options.workspacePath,
	)
		.flatMap((directoryPath) => discoverPluginModulePaths(directoryPath))
		.filter((path) => existsSync(path));
	const configuredPaths = resolveConfiguredPluginModulePaths(
		options.pluginPaths ?? [],
		cwd,
	);

	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const path of [...configuredPaths, ...discoveredFromSearchPaths]) {
		if (seen.has(path)) {
			continue;
		}
		seen.add(path);
		deduped.push(path);
	}
	return deduped;
}

export interface ResolveAndLoadAgentPluginsOptions
	extends ResolveAgentPluginPathsOptions {
	mode?: "sandbox" | "in_process";
	exportName?: string;
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	contributionTimeoutMs?: number;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
}

export async function resolveAndLoadAgentPlugins(
	options: ResolveAndLoadAgentPluginsOptions = {},
): Promise<{
	extensions: AgentPlugin[];
	shutdown?: () => Promise<void>;
}> {
	const paths = resolveAgentPluginPaths(options);
	if (paths.length === 0) {
		return { extensions: [] };
	}

	if (options.mode === "in_process") {
		return {
			extensions: await loadAgentPluginsFromPaths(paths, {
				cwd: options.cwd,
				exportName: options.exportName,
			}),
		};
	}

	const sandboxed = await loadSandboxedPlugins({
		pluginPaths: paths,
		exportName: options.exportName,
		importTimeoutMs: options.importTimeoutMs,
		hookTimeoutMs: options.hookTimeoutMs,
		contributionTimeoutMs: options.contributionTimeoutMs,
		onEvent: options.onEvent,
	});
	return {
		extensions: sandboxed.extensions ?? [],
		shutdown: sandboxed.shutdown,
	};
}
