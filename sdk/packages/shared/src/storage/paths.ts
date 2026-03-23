import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const AGENT_CONFIG_DIRECTORY_NAME = "agents";
export const HOOKS_CONFIG_DIRECTORY_NAME = "hooks";
export const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export const RULES_CONFIG_DIRECTORY_NAME = "rules";
export const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";
export const PLUGINS_DIRECTORY_NAME = "plugins";
export const CLINE_MCP_SETTINGS_FILE_NAME = "cline_mcp_settings.json";

let HOME_DIR = process?.env?.HOME || "~";
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
		join(workspacePath, ".clinerules", SKILLS_CONFIG_DIRECTORY_NAME),
		join(workspacePath, ".cline", SKILLS_CONFIG_DIRECTORY_NAME),
		join(workspacePath, ".claude", SKILLS_CONFIG_DIRECTORY_NAME),
		join(workspacePath, ".agents", SKILLS_CONFIG_DIRECTORY_NAME),
	];
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
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".clinerules", HOOKS_CONFIG_DIRECTORY_NAME)
			: "",
		resolveDocumentsHooksDirectoryPath(),
	]);
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		...getWorkspaceSkillDirectories(workspacePath),
		join(resolveClineDataDir(), "settings", SKILLS_CONFIG_DIRECTORY_NAME),
		join(resolveClineDir(), SKILLS_CONFIG_DIRECTORY_NAME),
		join(HOME_DIR, ".agents", SKILLS_CONFIG_DIRECTORY_NAME),
	]);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".clinerules") : "",
		join(resolveClineDataDir(), "settings", RULES_CONFIG_DIRECTORY_NAME),
		resolveDocumentsRulesDirectoryPath(),
	]);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".clinerules", "workflows") : "",
		join(resolveClineDataDir(), "settings", WORKFLOWS_CONFIG_DIRECTORY_NAME),
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
		join(HOME_DIR, ".agents", PLUGINS_DIRECTORY_NAME),
	]);
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
