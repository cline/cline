import { existsSync, readFileSync, statSync } from "node:fs";
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

function mergePluginPaths(paths: Iterable<string>): string[] {
	const deduped = dedupePaths(paths);
	return filterDisabledPluginPaths(deduped);
}

function resolveDiscoveredPluginPaths(
	workspacePath: string | undefined,
): string[] {
	return resolvePluginConfigSearchPaths(workspacePath)
		.flatMap((directoryPath) => discoverPluginModulePaths(directoryPath))
		.filter((path) => existsSync(path));
}

function resolveConfiguredPluginModulePathsBestEffort(
	pluginPaths: ReadonlyArray<string>,
	cwd: string,
): string[] {
	const resolvedPaths: string[] = [];
	for (const pluginPath of pluginPaths) {
		try {
			resolvedPaths.push(
				...resolveConfiguredPluginModulePaths([pluginPath], cwd),
			);
		} catch {}
	}
	return resolvedPaths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readDeclaredPluginEntryPaths(packageRoot: string): string[] {
	try {
		const parsed = JSON.parse(
			readFileSync(join(packageRoot, PACKAGE_JSON_FILE_NAME), "utf8"),
		) as unknown;
		if (!isRecord(parsed) || !isRecord(parsed.cline)) {
			return [];
		}
		const entries = parsed.cline.plugins;
		if (!Array.isArray(entries)) {
			return [];
		}
		const paths: string[] = [];
		for (const entry of entries) {
			if (typeof entry === "string") {
				paths.push(entry);
				continue;
			}
			if (!isRecord(entry) || !Array.isArray(entry.paths)) {
				continue;
			}
			for (const path of entry.paths) {
				if (typeof path === "string") {
					paths.push(path);
				}
			}
		}
		return paths;
	} catch {
		return [];
	}
}

function packageDeclaresPluginEntry(
	packageRoot: string,
	entryPath: string,
): boolean {
	const normalizedEntryPath = resolve(entryPath);
	return readDeclaredPluginEntryPaths(packageRoot).some(
		(declaredPath) =>
			resolve(packageRoot, declaredPath) === normalizedEntryPath,
	);
}

function isInstalledPackageDirectory(path: string, entryPath: string): boolean {
	return (
		basename(path) === INSTALLED_PACKAGE_DIRECTORY_NAME &&
		existsSync(join(dirname(path), PACKAGE_JSON_FILE_NAME)) &&
		packageDeclaresPluginEntry(dirname(path), entryPath)
	);
}

function collectPluginSkillRootCandidates(entryPath: string): string[] {
	const normalizedEntryPath = resolve(entryPath);
	const candidates: string[] = [];
	let current = dirname(normalizedEntryPath);

	while (true) {
		if (isInstalledPackageDirectory(current, normalizedEntryPath)) {
			candidates.push(current);
			break;
		}
		if (existsSync(join(current, PACKAGE_JSON_FILE_NAME))) {
			// Do not keep walking after the first package boundary. A monorepo
			// plugin entry can live under packages/foo/src/index.ts with no local
			// package.json; climbing to the workspace root would expose unrelated
			// root skills/. Only package manifests that declare this entry own skills.
			if (packageDeclaresPluginEntry(current, normalizedEntryPath)) {
				candidates.push(current);
			}
			break;
		}

		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}

	return dedupePaths(candidates);
}

export function resolveAgentPluginPaths(
	options: ResolveAgentPluginPathsOptions = {},
): string[] {
	const cwd = options.cwd ?? process.cwd();
	const discoveredFromSearchPaths = resolveDiscoveredPluginPaths(
		options.workspacePath,
	);
	const configuredPaths = resolveConfiguredPluginModulePaths(
		options.pluginPaths ?? [],
		cwd,
	);

	return mergePluginPaths([...configuredPaths, ...discoveredFromSearchPaths]);
}

function resolveAgentPluginPathsBestEffort(
	options: ResolveAgentPluginPathsOptions = {},
): string[] {
	const cwd = options.cwd ?? process.cwd();
	const discoveredFromSearchPaths = resolveDiscoveredPluginPaths(
		options.workspacePath,
	);
	const configuredPaths = resolveConfiguredPluginModulePathsBestEffort(
		options.pluginPaths ?? [],
		cwd,
	);

	return mergePluginPaths([...configuredPaths, ...discoveredFromSearchPaths]);
}

export function resolvePluginSkillDirectoriesFromPaths(
	pluginPaths: ReadonlyArray<string>,
): string[] {
	const directories: string[] = [];
	for (const pluginPath of pluginPaths) {
		for (const root of collectPluginSkillRootCandidates(pluginPath)) {
			const skillDirectory = join(root, SKILLS_CONFIG_DIRECTORY_NAME);
			if (isDirectory(skillDirectory)) {
				directories.push(skillDirectory);
			}
		}
	}
	return dedupePaths(directories);
}

export function resolveAgentPluginSkillDirectories(
	options: ResolveAgentPluginPathsOptions = {},
): string[] {
	return resolvePluginSkillDirectoriesFromPaths(
		resolveAgentPluginPathsBestEffort(options),
	);
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
		pluginPaths: string[];
		shutdown?: () => Promise<void>;
	} & PluginLoadDiagnostics
> {
	const paths = resolveAgentPluginPaths(options);
	if (paths.length === 0) {
		return { extensions: [], failures: [], warnings: [], pluginPaths: [] };
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
			pluginPaths: report.pluginPaths,
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
		pluginPaths: sandboxed.pluginPaths,
		warnings: sandboxed.warnings,
	};
}
