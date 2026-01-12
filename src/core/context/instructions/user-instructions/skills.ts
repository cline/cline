import { ensureSkillsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import type { SkillContent, SkillMetadata } from "@shared/skills"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import * as fs from "fs/promises"
import * as yaml from "js-yaml"
import * as path from "path"

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
	try {
		const data = yaml.load(yamlContent) as Record<string, unknown>
		return { data: data || {}, content: body }
	} catch (error) {
		console.warn("Failed to parse YAML frontmatter:", error)
		return { data: {}, content: fileContent }
	}
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md files.
 */
async function scanSkillsDirectory(dirPath: string, source: "global" | "project"): Promise<SkillMetadata[]> {
	const skills: SkillMetadata[] = []

	if (!(await fileExistsAtPath(dirPath)) || !(await isDirectory(dirPath))) {
		return skills
	}

	try {
		const entries = await fs.readdir(dirPath)

		for (const entryName of entries) {
			const entryPath = path.join(dirPath, entryName)
			const stats = await fs.stat(entryPath).catch(() => null)
			if (!stats?.isDirectory()) continue

			const skill = await loadSkillMetadata(entryPath, source, entryName)
			if (skill) {
				skills.push(skill)
			}
		}
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EACCES") {
			console.warn(`Permission denied reading skills directory: ${dirPath}`)
		}
	}

	return skills
}

/**
 * Load skill metadata from a skill directory.
 */
async function loadSkillMetadata(
	skillDir: string,
	source: "global" | "project",
	skillName: string,
): Promise<SkillMetadata | null> {
	const skillMdPath = path.join(skillDir, "SKILL.md")
	if (!(await fileExistsAtPath(skillMdPath))) return null

	try {
		const fileContent = await fs.readFile(skillMdPath, "utf-8")
		const { data: frontmatter } = parseFrontmatter(fileContent)

		// Validate required fields
		if (!frontmatter.name || typeof frontmatter.name !== "string") {
			console.warn(`Skill at ${skillDir} missing required 'name' field`)
			return null
		}
		if (!frontmatter.description || typeof frontmatter.description !== "string") {
			console.warn(`Skill at ${skillDir} missing required 'description' field`)
			return null
		}

		// Name must match directory name per spec
		if (frontmatter.name !== skillName) {
			console.warn(`Skill name "${frontmatter.name}" doesn't match directory "${skillName}"`)
			return null
		}

		return {
			name: skillName,
			description: frontmatter.description,
			path: skillMdPath,
			source,
		}
	} catch (error) {
		console.warn(`Failed to load skill at ${skillDir}:`, error)
		return null
	}
}

/**
 * Discover all skills from global (~/.cline/skills) and project directories.
 * Returns skills in order: project skills first, then global skills.
 * Global skills take precedence over project skills with the same name.
 */
export async function discoverSkills(cwd: string): Promise<SkillMetadata[]> {
	const skills: SkillMetadata[] = []

	const globalSkillsDir = await ensureSkillsDirectoryExists()
	const projectDirs = [
		path.join(cwd, GlobalFileNames.clineruleSkillsDir),
		path.join(cwd, GlobalFileNames.clineSkillsDir),
		path.join(cwd, GlobalFileNames.claudeSkillsDir),
	]

	// Load project skills first (lower priority)
	for (const dir of projectDirs) {
		const projectSkills = await scanSkillsDirectory(dir, "project")
		skills.push(...projectSkills)
	}

	// Load global skills last (~/.cline/skills) - higher priority
	const globalSkills = await scanSkillsDirectory(globalSkillsDir, "global")
	skills.push(...globalSkills)

	return skills
}

/**
 * Get available skills with override resolution (global > project).
 */
export function getAvailableSkills(skills: SkillMetadata[]): SkillMetadata[] {
	const seen = new Set<string>()
	const result: SkillMetadata[] = []

	// Iterate backwards: global skills (added last) are seen first and take precedence
	for (let i = skills.length - 1; i >= 0; i--) {
		const skill = skills[i]
		if (!seen.has(skill.name)) {
			seen.add(skill.name)
			result.unshift(skill)
		}
	}

	return result
}

/**
 * Get full skill content including instructions.
 */
export async function getSkillContent(skillName: string, availableSkills: SkillMetadata[]): Promise<SkillContent | null> {
	const skill = availableSkills.find((s) => s.name === skillName)
	if (!skill) return null

	try {
		const fileContent = await fs.readFile(skill.path, "utf-8")
		const { content: body } = parseFrontmatter(fileContent)

		return {
			...skill,
			instructions: body.trim(),
		}
	} catch {
		return null
	}
}
