import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type {
	AgentConfig,
	PluginPolicies,
	PluginSetupContext,
	SessionPluginIssue,
	WorkspaceInfo,
} from "@cline/shared";
import {
	discoverPluginModulePaths as discoverPluginModulePathsFromShared,
	getPluginDisplayName,
	resolveConfiguredPluginModulePaths,
	resolvePluginConfigSearchPaths as resolvePluginConfigSearchPathsFromShared,
	SKILLS_CONFIG_DIRECTORY_NAME,
} from "@cline/shared/storage";
import { filterDisabledPluginPaths } from "../../services/global-settings";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import {
	getProcessPluginRegistry,
	type PluginHookErrorMode,
	type PluginRegistry,
} from "./plugin-registry";
import { loadSandboxedPlugins } from "./plugin-sandbox";
import type { PluginTargeting } from "./plugin-targeting";

export { getPluginDisplayName };

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
	includeDisabled?: boolean;
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

/**
 * Like {@link resolveAgentPluginPaths}, but never throws: configured paths
 * that cannot be resolved come back as `discoveryFailures`, and paths turned
 * off in settings come back as `disabledPaths`, so callers can report both.
 */
export function resolveAgentPluginPathsWithDiagnostics(
	options: ResolveAgentPluginPathsOptions = {},
): {
	paths: string[];
	disabledPaths: string[];
	discoveryFailures: Array<{ pluginPath: string; error: unknown }>;
} {
	const cwd = options.cwd ?? process.cwd();
	const discoveryFailures: Array<{ pluginPath: string; error: unknown }> = [];
	const configuredPaths: string[] = [];
	for (const pluginPath of options.pluginPaths ?? []) {
		try {
			configuredPaths.push(
				...resolveConfiguredPluginModulePaths([pluginPath], cwd),
			);
		} catch (error) {
			discoveryFailures.push({ pluginPath: resolve(cwd, pluginPath), error });
		}
	}
	const all = dedupePaths([
		...configuredPaths,
		...resolveDiscoveredPluginPaths(options.workspacePath),
	]);
	if (options.includeDisabled) {
		return { paths: all, disabledPaths: [], discoveryFailures };
	}
	const enabled = filterDisabledPluginPaths(all);
	const enabledSet = new Set(enabled);
	return {
		paths: enabled,
		disabledPaths: all.filter((path) => !enabledSet.has(path)),
		discoveryFailures,
	};
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

	const paths = [...configuredPaths, ...discoveredFromSearchPaths];
	return options.includeDisabled ? dedupePaths(paths) : mergePluginPaths(paths);
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

export type PluginExecutionMode = "sandbox" | "in_process";

export const CLINE_PLUGIN_MODE_ENV = "CLINE_PLUGIN_MODE";

/**
 * Plugins load in the host process by default. The subprocess sandbox stays
 * available as an opt-in (`mode: "sandbox"` or `CLINE_PLUGIN_MODE=sandbox`).
 */
export function resolvePluginExecutionMode(
	mode?: PluginExecutionMode,
): PluginExecutionMode {
	if (mode) return mode;
	return process.env[CLINE_PLUGIN_MODE_ENV]?.trim() === "sandbox"
		? "sandbox"
		: "in_process";
}

export interface ResolveAndLoadAgentPluginsOptions
	extends ResolveAgentPluginPathsOptions,
		PluginTargeting {
	mode?: PluginExecutionMode;
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
	/**
	 * Per-session plugin selection (`"*"` default plus per-plugin overrides).
	 * In-process only; the sandbox loads every discovered plugin.
	 */
	policy?: PluginPolicies;
	/** How a failing plugin hook affects the run. Defaults to `"ignore"`. */
	hookErrorMode?: PluginHookErrorMode;
	/** In-process registry. Defaults to the process-wide registry. */
	registry?: PluginRegistry;
	/** In-process only: a plugin this session uses became degraded or failed. */
	onIssue?: (issue: SessionPluginIssue) => void;
}

export async function resolveAndLoadAgentPlugins(
	options: ResolveAndLoadAgentPluginsOptions = {},
): Promise<
	{
		extensions: AgentPlugin[];
		pluginPaths: string[];
		/** Plugins the session asked for but does not have (failed, disabled). */
		issues: SessionPluginIssue[];
		shutdown?: () => Promise<void>;
	} & PluginLoadDiagnostics
> {
	const mode = resolvePluginExecutionMode(options.mode);
	if (mode === "in_process") {
		const resolved = resolveAgentPluginPathsWithDiagnostics(options);
		if (
			resolved.paths.length === 0 &&
			resolved.disabledPaths.length === 0 &&
			resolved.discoveryFailures.length === 0
		) {
			return {
				extensions: [],
				failures: [],
				warnings: [],
				pluginPaths: [],
				issues: [],
			};
		}
		const registry = options.registry ?? getProcessPluginRegistry();
		const loaded = await registry.loadForSession({
			sessionId: options.session?.sessionId,
			pluginPaths: resolved.paths,
			disabledPluginPaths: resolved.disabledPaths,
			discoveryFailures: resolved.discoveryFailures,
			policy: options.policy,
			exportName: options.exportName,
			providerId: options.providerId,
			modelId: options.modelId,
			cwd: options.cwd,
			hookErrorMode: options.hookErrorMode,
			emitEvent: options.onEvent,
			onIssue: options.onIssue,
			importTimeoutMs: options.importTimeoutMs,
			hookTimeoutMs: options.hookTimeoutMs,
			callTimeoutMs: options.contributionTimeoutMs,
			setupContext: {
				session: options.session,
				client: options.client,
				user: options.user,
				workspaceInfo: options.workspaceInfo,
				automation: options.automation,
				logger: options.logger,
				telemetry: options.telemetry,
			},
		});
		return {
			extensions: loaded.extensions,
			failures: loaded.failures,
			pluginPaths: loaded.pluginPaths,
			warnings: loaded.warnings,
			issues: loaded.issues,
			shutdown: async () => loaded.release(),
		};
	}

	// The sandbox does not apply the per-session `policy`; it is an opt-in
	// escape hatch and loads every discovered plugin.
	const paths = resolveAgentPluginPaths(options);
	if (paths.length === 0) {
		return {
			extensions: [],
			failures: [],
			warnings: [],
			pluginPaths: [],
			issues: [],
		};
	}
	const sandboxed = await loadSandboxedPlugins({
		pluginPaths: paths,
		exportName: options.exportName,
		importTimeoutMs: options.importTimeoutMs,
		hookTimeoutMs: options.hookTimeoutMs,
		contributionTimeoutMs: options.contributionTimeoutMs,
		onEvent: options.onEvent,
		telemetryAvailable: Boolean(options.telemetry),
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
		issues: sandboxed.failures.map(
			(failure): SessionPluginIssue => ({
				name:
					failure.pluginName ??
					basename(failure.pluginPath, extname(failure.pluginPath)),
				pluginPath: failure.pluginPath,
				state: "failed",
				reason: "error",
				lastError: {
					phase: failure.phase === "setup" ? "setup" : "import",
					message: failure.message,
					stack: failure.stack,
					pluginPath: failure.pluginPath,
					timestamp: Date.now(),
				},
			}),
		),
	};
}
