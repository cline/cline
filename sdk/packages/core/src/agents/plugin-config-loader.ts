import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentConfig } from "@clinebot/agents";
import { resolvePluginConfigSearchPaths as resolvePluginConfigSearchPathsFromShared } from "@clinebot/shared/storage";
import { loadAgentPluginsFromPaths } from "./plugin-loader";
import { loadSandboxedPlugins } from "./plugin-sandbox";

const PLUGIN_MODULE_EXTENSIONS = new Set([
	".js",
	".mjs",
	".cjs",
	".ts",
	".mts",
	".cts",
]);

type AgentPlugin = NonNullable<AgentConfig["extensions"]>[number];

export function resolvePluginConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolvePluginConfigSearchPathsFromShared(workspacePath);
}

function hasPluginModuleExtension(path: string): boolean {
	const dot = path.lastIndexOf(".");
	if (dot === -1) {
		return false;
	}
	return PLUGIN_MODULE_EXTENSIONS.has(path.slice(dot));
}

export function discoverPluginModulePaths(directoryPath: string): string[] {
	const root = resolve(directoryPath);
	if (!existsSync(root)) {
		return [];
	}
	const discovered: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const candidate = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(candidate);
				continue;
			}
			if (entry.isFile() && hasPluginModuleExtension(candidate)) {
				discovered.push(candidate);
			}
		}
	}
	return discovered.sort((a, b) => a.localeCompare(b));
}

function resolveConfiguredPluginPaths(
	pluginPaths: ReadonlyArray<string>,
	cwd: string,
): string[] {
	const resolvedPaths: string[] = [];
	for (const pluginPath of pluginPaths) {
		const trimmed = pluginPath.trim();
		if (!trimmed) {
			continue;
		}
		const absolutePath = resolve(cwd, trimmed);
		if (!existsSync(absolutePath)) {
			throw new Error(`Plugin path does not exist: ${absolutePath}`);
		}
		const stats = statSync(absolutePath);
		if (stats.isDirectory()) {
			resolvedPaths.push(...discoverPluginModulePaths(absolutePath));
			continue;
		}
		if (!hasPluginModuleExtension(absolutePath)) {
			throw new Error(
				`Plugin file must use a supported extension (${[...PLUGIN_MODULE_EXTENSIONS].join(", ")}): ${absolutePath}`,
			);
		}
		resolvedPaths.push(absolutePath);
	}
	return resolvedPaths;
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
	const configuredPaths = resolveConfiguredPluginPaths(
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
