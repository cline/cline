import type { Dirent } from "node:fs";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PluginManifest } from "..";
import {
	BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME,
	BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME,
} from "./chat-workspace-paths";

// Keep the structural pieces browser-safe while exposing them through the
// canonical Node storage-path module alongside the data-dir resolver.
export {
	BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME,
	BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME,
	isChatWorkspacePath,
} from "./chat-workspace-paths";

const BEDROCK_CODER_CONFIG_DIR = ".bedrock-coder";
const LEGACY_AGENT_SKILLS_CONFIG_DIR = ".agents";

export const AGENT_CONFIG_DIRECTORY_NAME = "agents";
export const HOOKS_CONFIG_DIRECTORY_NAME = "hooks";
export const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export const RULES_CONFIG_DIRECTORY_NAME = "rules";
export const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";
export const PLUGINS_DIRECTORY_NAME = "plugins";
export const AGENTS_RULES_FILE_NAME = "AGENTS.md";

/**
 * Shared workspace for all sessions started without a `cwd`/`workspaceRoot`.
 * Lives under the bedrockCoder data dir (not `os.tmpdir()`) so OS temp reapers never
 * delete user work, the path is private to the user on multi-user hosts, and
 * the directory shares the session store's lifecycle and env overrides.
 */
export function resolveChatWorkspacePath(): string {
	return join(
		resolveBedrockCoderDataDir(),
		BEDROCK_CODER_WORKSPACES_DIRECTORY_NAME,
		BEDROCK_CODER_CHAT_WORKSPACE_DIRECTORY_NAME,
	);
}

export const BEDROCK_CODER_MCP_SETTINGS_FILE_NAME = "mcp_settings.json";

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

let BEDROCK_CODER_DIR: string | undefined;
let BEDROCK_CODER_DIR_SET_EXPLICITLY = false;

export function setBedrockCoderDir(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	BEDROCK_CODER_DIR = trimmed;
	BEDROCK_CODER_DIR_SET_EXPLICITLY = true;
}

export function setBedrockCoderDirIfUnset(dir: string): void {
	if (BEDROCK_CODER_DIR_SET_EXPLICITLY) {
		return;
	}
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	BEDROCK_CODER_DIR = trimmed;
}

export function resolveBedrockCoderDir(): string {
	if (BEDROCK_CODER_DIR) {
		return BEDROCK_CODER_DIR;
	}
	const envDir = process.env.BEDROCK_CODER_DIR?.trim();
	if (envDir) {
		return envDir;
	}
	return join(HOME_DIR, ".bedrock-coder");
}

export function resolveBedrockCoderDataDir(): string {
	const explicitDir = process.env.BEDROCK_CODER_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveBedrockCoderDir(), "data");
}

export function resolveSessionDataDir(): string {
	const explicitDir = process.env.BEDROCK_CODER_SESSION_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveBedrockCoderDataDir(), "sessions");
}

export function resolveTeamDataDir(): string {
	const explicitDir = process.env.BEDROCK_CODER_TEAM_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveBedrockCoderDataDir(), "teams");
}

export function resolveDbDataDir(): string {
	const explicitDir = process.env.BEDROCK_CODER_DB_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveBedrockCoderDataDir(), "db");
}

export function resolveProviderSettingsPath(): string {
	const explicitPath = process.env.BEDROCK_CODER_PROVIDER_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveBedrockCoderDataDir(), "settings", "providers.json");
}

export function resolveGlobalSettingsPath(): string {
	const explicitPath = process.env.BEDROCK_CODER_GLOBAL_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveBedrockCoderDataDir(), "settings", "global-settings.json");
}

export function resolveMcpSettingsPath(): string {
	const explicitPath = process.env.BEDROCK_CODER_MCP_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveBedrockCoderDataDir(), "settings", BEDROCK_CODER_MCP_SETTINGS_FILE_NAME);
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
		BEDROCK_CODER_CONFIG_DIR,
		LEGACY_AGENT_SKILLS_CONFIG_DIR,
	].map((dir) => join(workspacePath, dir, SKILLS_CONFIG_DIRECTORY_NAME));
}

export function resolveAgentsConfigDirPath(): string {
	return join(resolveBedrockCoderDir(), AGENT_CONFIG_DIRECTORY_NAME);
}

export function resolveAgentConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, BEDROCK_CODER_CONFIG_DIR, AGENT_CONFIG_DIRECTORY_NAME)
			: "",
		resolveAgentsConfigDirPath(),
	]);
}

export function resolveHooksConfigSearchPaths(
	workspacePath?: string,
): string[] {
	const hooks = [join(resolveBedrockCoderDir(), HOOKS_CONFIG_DIRECTORY_NAME)];
	if (workspacePath) {
		hooks.push(join(workspacePath, BEDROCK_CODER_CONFIG_DIR, HOOKS_CONFIG_DIRECTORY_NAME));
	}
	return dedupePaths(hooks);
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		...getWorkspaceSkillDirectories(workspacePath),
		join(resolveBedrockCoderDir(), SKILLS_CONFIG_DIRECTORY_NAME),
		join(
			HOME_DIR,
			LEGACY_AGENT_SKILLS_CONFIG_DIR,
			SKILLS_CONFIG_DIRECTORY_NAME,
		),
	]);
}

export function resolveGlobalAgentsRulesPath(): string {
	return join(HOME_DIR, LEGACY_AGENT_SKILLS_CONFIG_DIR, AGENTS_RULES_FILE_NAME);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	const wsPaths = workspacePath
		? [join(workspacePath, BEDROCK_CODER_CONFIG_DIR, RULES_CONFIG_DIRECTORY_NAME)]
		: [];
	const workspaceAgentsFile = workspacePath
		? [join(workspacePath, AGENTS_RULES_FILE_NAME)]
		: [];
	return dedupePaths([
		...workspaceAgentsFile,
		...wsPaths,
		resolveGlobalAgentsRulesPath(),
		join(resolveBedrockCoderDir(), RULES_CONFIG_DIRECTORY_NAME),
	]);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".bedrock-coder", WORKFLOWS_CONFIG_DIRECTORY_NAME)
			: "",
		join(resolveBedrockCoderDir(), WORKFLOWS_CONFIG_DIRECTORY_NAME),
	]);
}

export function resolvePluginConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".bedrock-coder", PLUGINS_DIRECTORY_NAME) : "",
		join(resolveBedrockCoderDir(), PLUGINS_DIRECTORY_NAME),
	]);
}

const PLUGIN_MODULE_EXTENSIONS = new Set([".js", ".ts"]);
const PLUGIN_PACKAGE_JSON_FILE_NAME = "package.json";
const PLUGIN_DIRECTORY_INDEX_CANDIDATES = ["index.ts", "index.js"];

interface PluginPackageManifest {
	plugins?: PluginManifest[];
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
			bedrockCoder?: PluginPackageManifest;
		};
		if (!packageJson.bedrockCoder || typeof packageJson.bedrockCoder !== "object") {
			return null;
		}
		return packageJson.bedrockCoder;
	} catch {
		return null;
	}
}

function getManifestPluginEntries(
	manifest: PluginPackageManifest | null,
): string[] {
	const entries = manifest?.plugins;
	if (!Array.isArray(entries)) {
		return [];
	}
	return entries.flatMap((entry) => entry.paths ?? []);
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
		let entries: Dirent[];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const candidate = join(current, entry.name);
			if (entry.isDirectory()) {
				const packageJsonPath = join(candidate, PLUGIN_PACKAGE_JSON_FILE_NAME);
				if (existsSync(packageJsonPath)) {
					const manifest = readPluginPackageManifest(packageJsonPath);
					const entries = getManifestPluginEntries(manifest)
						.map((e) => resolve(candidate, e))
						.filter(
							(entryPath) =>
								existsSync(entryPath) &&
								statSync(entryPath).isFile() &&
								isPluginModulePath(entryPath),
						);
					if (entries.length > 0) {
						discovered.push(...entries);
						continue;
					}
				}
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

export function ensureFileExists(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, "");
}

export function ensureHookLogDir(filePath?: string): string {
	if (filePath?.trim()) {
		ensureParentDir(filePath);
		return dirname(filePath);
	}
	const dir = join(resolveBedrockCoderDataDir(), "logs");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}
