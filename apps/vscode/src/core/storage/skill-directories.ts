import os from "os"
import * as path from "path"

const SKILL_DIRECTORY_NAMES = {
	clineruleSkillsDir: ".clinerules/skills",
	clineSkillsDir: ".cline/skills",
	claudeSkillsDir: ".claude/skills",
	agentsSkillsDir: ".agents/skills",
} as const

export type SkillsScanDirectory = {
	path: string
	source: "project" | "global"
}

function getClineHomePath(): string {
	return path.join(os.homedir(), ".cline")
}

function getClineSkillsDirectoryPath(): string {
	return path.join(getClineHomePath(), "skills")
}

function getAgentSkillsDirectoryPath(): string {
	return path.join(os.homedir(), ".agents", "skills")
}

/**
 * Returns the list of skills directories to scan without creating them.
 * Order is project directories first, then global directories.
 */
export function getSkillsDirectoriesForScan(cwd: string): SkillsScanDirectory[] {
	return [
		{ path: path.join(cwd, SKILL_DIRECTORY_NAMES.clineruleSkillsDir), source: "project" },
		{ path: path.join(cwd, SKILL_DIRECTORY_NAMES.clineSkillsDir), source: "project" },
		{ path: path.join(cwd, SKILL_DIRECTORY_NAMES.claudeSkillsDir), source: "project" },
		{ path: path.join(cwd, SKILL_DIRECTORY_NAMES.agentsSkillsDir), source: "project" },
		{ path: getClineSkillsDirectoryPath(), source: "global" },
		{ path: getAgentSkillsDirectoryPath(), source: "global" },
	]
}
