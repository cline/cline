import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEPRECATED_CONFIG_DIR = ".clinerules";
const CLINE_CONFIG_DIR = ".cline";
export const AGENT_CONFIG_DIRECTORY_NAME = "agents";

export const HOOKS_CONFIG_DIRECTORY_NAME = "hooks";
export const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export const RULES_CONFIG_DIRECTORY_NAME = "rules";
export const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";
export const PLUGINS_DIRECTORY_NAME = "plugins";
export const CLINE_MCP_SETTINGS_FILE_NAME = "cline_mcp_settings.json";

function resolveDefaultHomeDir(): string {
	const envHome = process?.env?.HOME?.trim();
	if (envHome && envHome !== "~") {
		return envHome;
	}
	const envUserProfile = process?.env?.USERPROFILE?.trim();
	if (envUserProfile) {
		return envUserProfile;
	}
	const envHomeDrive = process?.env?.HOMEDRIVE?.trim();
	const envHomePath = process?.env?.HOMEPATH?.trim();
	if (envHomeDrive && envHomePath) {
		return `${envHomeDrive}${envHomePath}`;
	}
	const osHomeDir = homedir().trim();
	if (osHomeDir && osHomeDir !== "~") {
		return osHomeDir;
	}
	return "~";
}

let HOME_DIR = resolveDefaultHomeDir();
let HOME_DIR_SET_EXPLICITLY = false;

export function setHomeDir(dir: string) {
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	HOME_DIR = trimmed;
	HOME_DIR_SET_EXPLICITLY = true;
}

export function setHomeDirIfUnset(dir: string) {
	if (HOME_DIR_SET_EXPLICITLY) {
		return;
	}
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	HOME_DIR = trimmed;
}

let CLINE_DIR: string | undefined;
let CLINE_DIR_SET_EXPLICITLY = false;

export function setClineDir(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	CLINE_DIR = trimmed;
	CLINE_DIR_SET_EXPLICITLY = true;
}

export function setClineDirIfUnset(dir: string): void {
	if (CLINE_DIR_SET_EXPLICITLY) {
		return;
	}
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	CLINE_DIR = trimmed;
}

export function resolveClineDir(): string {
	if (CLINE_DIR) {
		return CLINE_DIR;
	}
	const envDir = process.env.CLINE_DIR?.trim();
	if (envDir) {
		return envDir;
	}
	return join(HOME_DIR, ".cline");
}

export function resolveDocumentsClineDirectoryPath(): string {
	return join(HOME_DIR, "Documents", "Cline");
}

export function resolveDocumentsExtensionsPath(subpath: string): string {
	return join(resolveDocumentsClineDirectoryPath(), subpath);
}

export function resolveDocumentsAgentConfigDirectoryPath(): string {
	return join(resolveDocumentsClineDirectoryPath(), "Agents");
}

export function resolveDocumentsHooksDirectoryPath(): string {
	return join(resolveDocumentsClineDirectoryPath(), "Hooks");
}

export function resolveDocumentsRulesDirectoryPath(): string {
	return join(resolveDocumentsClineDirectoryPath(), "Rules");
}

export function resolveDocumentsWorkflowsDirectoryPath(): string {
	return join(resolveDocumentsClineDirectoryPath(), "Workflows");
}

export function resolveDocumentsPluginsDirectoryPath(): string {
	return join(resolveDocumentsClineDirectoryPath(), "Plugins");
}

export function resolveClineDataDir(): string {
	const explicitDir = process.env.CLINE_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDir(), "data");
}

export function resolveSessionDataDir(): string {
	const explicitDir = process.env.CLINE_SESSION_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDataDir(), "sessions");
}

export function resolveTeamDataDir(): string {
	const explicitDir = process.env.CLINE_TEAM_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDataDir(), "teams");
}

export function resolveProviderSettingsPath(): string {
	const explicitPath = process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveClineDataDir(), "settings", "providers.json");
}

export function resolveMcpSettingsPath(): string {
	const explicitPath = process.env.CLINE_MCP_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveClineDataDir(), "settings", CLINE_MCP_SETTINGS_FILE_NAME);
}

function dedupePaths(paths: ReadonlyArray<string>): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const candidate of paths) {
		if (!candidate || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		deduped.push(candidate);
	}
	return deduped;
}

function getWorkspaceSkillDirectories(workspacePath?: string): string[] {
	if (!workspacePath) {
		return [];
	}
	return [
		DEPRECATED_CONFIG_DIR,
		CLINE_CONFIG_DIR,
		AGENT_CONFIG_DIRECTORY_NAME,
	].map((dir) => join(workspacePath, dir, SKILLS_CONFIG_DIRECTORY_NAME));
}

export function resolveAgentsConfigDirPath(): string {
	return join(resolveClineDataDir(), "settings", AGENT_CONFIG_DIRECTORY_NAME);
}

export function resolveAgentConfigSearchPaths(): string[] {
	return [
		resolveDocumentsAgentConfigDirectoryPath(),
		resolveAgentsConfigDirPath(),
	];
}

export function resolveHooksConfigSearchPaths(
	workspacePath?: string,
): string[] {
	const hooks = [
		resolveDocumentsHooksDirectoryPath(),
		join(resolveClineDataDir(), HOOKS_CONFIG_DIRECTORY_NAME),
	];
	if (workspacePath) {
		hooks.push(
			join(workspacePath, DEPRECATED_CONFIG_DIR, HOOKS_CONFIG_DIRECTORY_NAME),
			join(workspacePath, CLINE_CONFIG_DIR, HOOKS_CONFIG_DIRECTORY_NAME),
		);
	}
	return dedupePaths(hooks);
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		...getWorkspaceSkillDirectories(workspacePath),
		join(resolveClineDir(), SKILLS_CONFIG_DIRECTORY_NAME),
		join(HOME_DIR, AGENT_CONFIG_DIRECTORY_NAME, SKILLS_CONFIG_DIRECTORY_NAME),
	]);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	const wsPaths = workspacePath
		? [".clinerules", ".cline"].map((prefix) =>
				join(workspacePath, prefix, RULES_CONFIG_DIRECTORY_NAME),
			)
		: [];
	const workspaceRoot = workspacePath ? [workspacePath] : [];
	return dedupePaths([
		...workspaceRoot,
		...wsPaths,
		join(resolveClineDataDir(), RULES_CONFIG_DIRECTORY_NAME),
		resolveDocumentsRulesDirectoryPath(),
	]);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".clinerules", WORKFLOWS_CONFIG_DIRECTORY_NAME)
			: "",
		join(resolveClineDataDir(), WORKFLOWS_CONFIG_DIRECTORY_NAME),
		resolveDocumentsWorkflowsDirectoryPath(),
	]);
}

export function resolvePluginConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".clinerules", PLUGINS_DIRECTORY_NAME)
			: "",
		join(resolveClineDir(), PLUGINS_DIRECTORY_NAME),
		resolveDocumentsPluginsDirectoryPath(),
	]);
}

const PLUGIN_MODULE_EXTENSIONS = new Set([
	".js",
	".mjs",
	".cjs",
	".ts",
	".mts",
	".cts",
]);
const PLUGIN_PACKAGE_JSON_FILE_NAME = "package.json";
const PLUGIN_DIRECTORY_INDEX_CANDIDATES = [
	"index.ts",
	"index.mts",
	"index.cts",
	"index.js",
	"index.mjs",
	"index.cjs",
];

interface PluginPackageManifest {
	plugins?: unknown;
	extensions?: unknown;
}

export function isPluginModulePath(path: string): boolean {
	const dot = path.lastIndexOf(".");
	if (dot === -1) {
		return false;
	}
	return PLUGIN_MODULE_EXTENSIONS.has(path.slice(dot));
}

function readPluginPackageManifest(
	packageJsonPath: string,
): PluginPackageManifest | null {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			cline?: PluginPackageManifest;
		};
		if (!packageJson.cline || typeof packageJson.cline !== "object") {
			return null;
		}
		return packageJson.cline;
	} catch {
		return null;
	}
}

function getManifestPluginEntries(
	manifest: PluginPackageManifest | null,
): string[] {
	const entries = manifest?.plugins ?? manifest?.extensions;
	if (!Array.isArray(entries)) {
		return [];
	}
	return entries.filter((entry): entry is string => typeof entry === "string");
}

export function resolvePluginModuleEntries(
	directoryPath: string,
): string[] | null {
	const root = resolve(directoryPath);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		return null;
	}

	const packageJsonPath = join(root, PLUGIN_PACKAGE_JSON_FILE_NAME);
	if (existsSync(packageJsonPath)) {
		const manifest = readPluginPackageManifest(packageJsonPath);
		const entries = getManifestPluginEntries(manifest)
			.map((entry) => resolve(root, entry))
			.filter(
				(entryPath) =>
					existsSync(entryPath) &&
					statSync(entryPath).isFile() &&
					isPluginModulePath(entryPath),
			);
		if (entries.length > 0) {
			return entries;
		}
	}

	for (const candidate of PLUGIN_DIRECTORY_INDEX_CANDIDATES) {
		const entryPath = join(root, candidate);
		if (existsSync(entryPath) && statSync(entryPath).isFile()) {
			return [entryPath];
		}
	}

	return null;
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
			if (entry.name.startsWith(".")) {
				continue;
			}
			if (entry.isFile() && isPluginModulePath(candidate)) {
				discovered.push(candidate);
			}
		}
	}
	return discovered.sort((a, b) => a.localeCompare(b));
}

export function resolveConfiguredPluginModulePaths(
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
			const entries = resolvePluginModuleEntries(absolutePath);
			if (entries) {
				resolvedPaths.push(...entries);
				continue;
			}
			resolvedPaths.push(...discoverPluginModulePaths(absolutePath));
			continue;
		}
		if (!isPluginModulePath(absolutePath)) {
			throw new Error(
				`Plugin file must use a supported extension (${[...PLUGIN_MODULE_EXTENSIONS].join(", ")}): ${absolutePath}`,
			);
		}
		resolvedPaths.push(absolutePath);
	}
	return resolvedPaths;
}

export function ensureParentDir(filePath: string): void {
	const parent = dirname(filePath);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
}

export function ensureHookLogDir(filePath?: string): string {
	if (filePath?.trim()) {
		ensureParentDir(filePath);
		return dirname(filePath);
	}
	const dir = join(resolveClineDataDir(), "hooks");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}
