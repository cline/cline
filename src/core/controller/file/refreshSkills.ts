import { RefreshedSkills, SkillInfo } from "@shared/proto/cline/file"
import fs from "fs/promises"
import path from "path"
import { getSkillsDirectoriesForScan } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { fileExistsAtPath, isDirectory } from "@/utils/fs"
import { Controller } from ".."

/**
 * Parse YAML frontmatter from markdown content.
 */
function parseFrontmatter(fileContent: string): { data: Record<string, unknown>; content: string } {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
	const match = fileContent.match(frontmatterRegex)

	if (!match) {
		return { data: {}, content: fileContent }
	}

	const [, yamlContent, body] = match
	// Simple YAML parsing for name and description
	const data: Record<string, unknown> = {}
	const lines = yamlContent.split("\n")
	for (const line of lines) {
		const colonIndex = line.indexOf(":")
		if (colonIndex > 0) {
			const key = line.slice(0, colonIndex).trim()
			const value = line
				.slice(colonIndex + 1)
				.trim()
				.replace(/^["']|["']$/g, "")
			data[key] = value
		}
	}
	return { data, content: body }
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md files.
 */
async function scanSkillsDirectory(dirPath: string): Promise<SkillInfo[]> {
	const skills: SkillInfo[] = []

	if (!(await fileExistsAtPath(dirPath)) || !(await isDirectory(dirPath))) {
		return skills
	}

	try {
		const entries = await fs.readdir(dirPath)

		for (const entryName of entries) {
			const entryPath = path.join(dirPath, entryName)
			const stats = await fs.stat(entryPath).catch(() => null)
			if (!stats?.isDirectory()) continue

			const skillMdPath = path.join(entryPath, "SKILL.md")
			if (!(await fileExistsAtPath(skillMdPath))) continue

			try {
				const fileContent = await fs.readFile(skillMdPath, "utf-8")
				const { data: frontmatter } = parseFrontmatter(fileContent)

				// Validate required fields
				if (!frontmatter.name || typeof frontmatter.name !== "string") continue
				if (!frontmatter.description || typeof frontmatter.description !== "string") continue
				if (frontmatter.name !== entryName) continue

				skills.push(
					SkillInfo.create({
						name: entryName,
						description: frontmatter.description,
						path: skillMdPath,
						enabled: true, // Will be updated with toggle state
					}),
				)
			} catch {
				// Skip invalid skills
			}
		}
	} catch {
		// Directory read error, skip
	}

	return skills
}

/**
 * Refreshes all skill toggles (discovers skills and their enabled state)
 */
export async function refreshSkills(controller: Controller): Promise<RefreshedSkills> {
	// Get workspace paths for local skills
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const primaryWorkspace = workspacePaths.paths[0]

	const globalSkills: SkillInfo[] = []
	const localSkills: SkillInfo[] = []

	if (primaryWorkspace) {
		const scanDirs = getSkillsDirectoriesForScan(primaryWorkspace)
		for (const dir of scanDirs) {
			const skills = await scanSkillsDirectory(dir.path)
			if (dir.source === "global") {
				globalSkills.push(...skills)
			} else {
				localSkills.push(...skills)
			}
		}
	} else {
		const scanDirs = getSkillsDirectoriesForScan("")
		for (const dir of scanDirs) {
			if (dir.source !== "global") continue
			const skills = await scanSkillsDirectory(dir.path)
			globalSkills.push(...skills)
		}
	}

	// Get global toggles and apply them
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalSkillsToggles") || {}
	for (const skill of globalSkills) {
		skill.enabled = globalToggles[skill.path] !== false
	}

	// Get local toggles and apply them
	const localToggles = controller.stateManager.getWorkspaceStateKey("localSkillsToggles") || {}
	for (const skill of localSkills) {
		skill.enabled = localToggles[skill.path] !== false
	}

	return RefreshedSkills.create({
		globalSkills,
		localSkills,
	})
}
