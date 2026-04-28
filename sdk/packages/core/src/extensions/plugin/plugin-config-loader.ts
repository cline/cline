import { existsSync } from "node:fs";
import type {
	AgentConfig,
	PluginSetupContext,
	WorkspaceInfo,
} from "@clinebot/shared";
import {
	discoverPluginModulePaths as discoverPluginModulePathsFromShared,
	resolveConfiguredPluginModulePaths,
	resolvePluginConfigSearchPaths as resolvePluginConfigSearchPathsFromShared,
} from "@clinebot/shared/storage";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import { loadAgentPluginsFromPathsWithDiagnostics } from "./plugin-loader";
import { loadSandboxedPlugins } from "./plugin-sandbox";
import type { PluginTargeting } from "./plugin-targeting";

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
	extends ResolveAgentPluginPathsOptions,
		PluginTargeting {
	mode?: "sandbox" | "in_process";
	exportName?: string;
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	contributionTimeoutMs?: number;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
	/**
	 * Structured workspace and git metadata. Forwarded to sandboxed plugins
	 * via PluginSetupCtx.workspaceInfo and made available to in-process plugins
	 * in the extension context.
	 */
	workspaceInfo?: WorkspaceInfo;
	session?: PluginSetupContext["session"];
	client?: PluginSetupContext["client"];
	user?: PluginSetupContext["user"];
	automation?: PluginSetupContext["automation"];
	logger?: PluginSetupContext["logger"];
	telemetry?: PluginSetupContext["telemetry"];
}

export async function resolveAndLoadAgentPlugins(
	options: ResolveAndLoadAgentPluginsOptions = {},
): Promise<
	{
		extensions: AgentPlugin[];
		shutdown?: () => Promise<void>;
	} & PluginLoadDiagnostics
> {
	const paths = resolveAgentPluginPaths(options);
	if (paths.length === 0) {
		return { extensions: [], failures: [], warnings: [] };
	}

	if (options.mode === "in_process") {
		const report = await loadAgentPluginsFromPathsWithDiagnostics(paths, {
			cwd: options.cwd,
			exportName: options.exportName,
			providerId: options.providerId,
			modelId: options.modelId,
			session: options.session,
			client: options.client,
			user: options.user,
			workspaceInfo: options.workspaceInfo,
			automation: options.automation,
			logger: options.logger,
			telemetry: options.telemetry,
		});
		return {
			extensions: report.plugins,
			failures: report.failures,
			warnings: report.warnings,
		};
	}

	const sandboxed = await loadSandboxedPlugins({
		pluginPaths: paths,
		exportName: options.exportName,
		importTimeoutMs: options.importTimeoutMs,
		hookTimeoutMs: options.hookTimeoutMs,
		contributionTimeoutMs: options.contributionTimeoutMs,
		onEvent: options.onEvent,
		providerId: options.providerId,
		modelId: options.modelId,
		cwd: options.cwd,
		session: options.session,
		client: options.client,
		user: options.user,
		workspaceInfo: options.workspaceInfo,
		logger: options.logger,
	});
	return {
		extensions: sandboxed.extensions ?? [],
		shutdown: sandboxed.shutdown,
		failures: sandboxed.failures,
		warnings: sandboxed.warnings,
	};
}
