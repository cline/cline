import * as fs from "node:fs/promises"
import * as path from "node:path"
import { type EmptyRequest, StringArray } from "@shared/proto/cline/common"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from ".."

/**
 * Reads .md filenames (without extension) from a directory.
 * Returns an empty array if the directory doesn't exist or can't be read.
 */
async function readMdFileIds(dirPath: string): Promise<string[]> {
	try {
		const files = await fs.readdir(dirPath)
		return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""))
	} catch {
		// Directory doesn't exist or can't be read, skip
		return []
	}
}

/**
 * Reads skill directory names that contain a SKILL.md file.
 * Returns an empty array if the directory doesn't exist or can't be read.
 */
async function readSkillIds(skillsDir: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(skillsDir)
		const ids: string[] = []
		for (const entry of entries) {
			const skillMdPath = path.join(skillsDir, entry, "SKILL.md")
			try {
				const stat = await fs.stat(skillMdPath)
				if (stat.isFile()) {
					ids.push(entry)
				}
			} catch {
				// No SKILL.md in this entry, skip
			}
		}
		return ids
	} catch {
		// Directory doesn't exist or can't be read, skip
		return []
	}
}

/**
 * Gets the list of currently applied prompt IDs by scanning workspace directories.
 *
 * Scans:
 * - .clinerules/          → rules (top-level .md files, excluding subdirectories)
 * - .clinerules/workflows → workflows
 * - .clinerules/hooks     → hooks
 * - .clinerules/skills    → skills (directories containing SKILL.md)
 */
export async function getAppliedPrompts(_controller: Controller, _request: EmptyRequest): Promise<StringArray> {
	try {
		const workspaceRoot = await getWorkspacePath()
		if (!workspaceRoot) {
			return { values: [] }
		}

		const clinerulesDir = path.join(workspaceRoot, ".clinerules")

		// Scan all four directories in parallel
		const [ruleIds, workflowIds, hookIds, skillIds] = await Promise.all([
			readMdFileIds(clinerulesDir),
			readMdFileIds(path.join(clinerulesDir, "workflows")),
			readMdFileIds(path.join(clinerulesDir, "hooks")),
			readSkillIds(path.join(clinerulesDir, "skills")),
		])

		// Prefix each ID with its type to avoid collisions between types
		// e.g. a rule and workflow both named "test" become "rule:test" and "workflow:test"
		const appliedPromptIds = [
			...ruleIds.map((id) => `rule:${id}`),
			...workflowIds.map((id) => `workflow:${id}`),
			...hookIds.map((id) => `hook:${id}`),
			...skillIds.map((id) => `skill:${id}`),
		]

		return StringArray.create({ values: appliedPromptIds })
	} catch {
		// Silently handle errors and return empty array
		return StringArray.create({ values: [] })
	}
}
