import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
	AgentConfig,
	PluginSetupContext,
	WorkspaceInfo,
} from "@cline/shared";
import {
	discoverPluginModulePaths as discoverPluginModulePathsFromShared,
	resolveConfiguredPluginModulePaths,
	resolvePluginConfigSearchPaths as resolvePluginConfigSearchPathsFromShared,
	SKILLS_CONFIG_DIRECTORY_NAME,
} from "@cline/shared/storage";
import { filterDisabledPluginPaths } from "../../services/global-settings";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import { loadAgentPluginsFromPathsWithDiagnostics } from "./plugin-loader";
import { loadSandboxedPlugins } from "./plugin-sandbox";
import type { PluginTargeting } from "./plugin-targeting";

type AgentPlugin = NonNullable<AgentConfig["extensions"]>[number];

const PACKAGE_JSON_FILE_NAME = "package.json";
const INSTALLED_PACKAGE_DIRECTORY_NAME = "package";

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

function isDirectory(path: string): boolean {
	try {
		return existsSync(path) && statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function dedupePaths(paths: Iterable<string>): string[] {
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const path of paths) {
		const normalizedPath = resolve(path);
		if (seen.has(normalizedPath)) {
			continue;
		}
		seen.add(normalizedPath);
		deduped.push(normalizedPath);
	}
	return deduped;
}

function isInstalledPackageDirectory(path: string): boolean {
	return (
		basename(path) === INSTALLED_PACKAGE_DIRECTORY_NAME &&
		existsSync(join(dirname(path), PACKAGE_JSON_FILE_NAME))
	);
}

function collectPluginSkillRootCandidates(entryPath: string): string[] {
	const normalizedEntryPath = resolve(entryPath);
	const candidates: string[] = [];
	let current = dirname(normalizedEntryPath);

	while (true) {
		if (isInstalledPackageDirectory(current)) {
			candidates.push(current);
		}
		if (existsSync(join(current, PACKAGE_JSON_FILE_NAME))) {
			candidates.push(current);
			break;
		}

		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}

	candidates.push(dirname(normalizedEntryPath));
	return dedupePaths(candidates);
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
	return filterDisabledPluginPaths(deduped);
}

export function resolveAgentPluginSkillDirectories(
	options: ResolveAgentPluginPathsOptions = {},
): string[] {
	const directories: string[] = [];
	for (const pluginPath of resolveAgentPluginPaths(options)) {
		for (const root of collectPluginSkillRootCandidates(pluginPath)) {
			const skillDirectory = join(root, SKILLS_CONFIG_DIRECTORY_NAME);
			if (isDirectory(skillDirectory)) {
				directories.push(skillDirectory);
			}
		}
	}
	return dedupePaths(directories);
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
