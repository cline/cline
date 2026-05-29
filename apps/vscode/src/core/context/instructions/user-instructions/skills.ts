import { getSkillsDirectoriesForScan } from "@core/storage/disk"
import type { GlobalInstructionsFile } from "@shared/remote-config/schema"
import type { SkillContent, SkillMetadata } from "@shared/skills"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import * as fs from "fs/promises"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"

/**
 * A remote skill entry after frontmatter validation.
 * name is always frontmatter.name (canonical). A warning is logged if entry.name drifts.
 */
export interface ValidatedRemoteSkill {
	name: string
	description: string
	alwaysEnabled: boolean
	contents: string
}

export interface SkillToggleState {
	globalSkillsToggles?: Record<string, boolean>
	localSkillsToggles?: Record<string, boolean>
	remoteSkillsToggles?: Record<string, boolean>
	remoteSkillEntries?: GlobalInstructionsFile[]
}

/**
 * Parse and validate remote skill entries from GlobalInstructionsFile[].
 *
 * Validates:
 *  - frontmatter.name and frontmatter.description are present strings
 *  - Warns if entry.name does not match frontmatter.name (drift)
 *
 * Returns only valid entries. Callers share this single validation point
 * instead of duplicating frontmatter parsing.
 */
export function parseRemoteSkillEntries(entries: GlobalInstructionsFile[]): ValidatedRemoteSkill[] {
	return entries
		.map((entry) => {
			const { data: frontmatter } = parseYamlFrontmatter(entry.contents)
			if (!frontmatter.name || typeof frontmatter.name !== "string") return null
			if (!frontmatter.description || typeof frontmatter.description !== "string") return null
			// Warn on drift but use frontmatter.name as the canonical identity.
			// The dashboard should keep entry.name in sync, but we don't reject on mismatch
			// since that would silently hide org-configured skills from users.
			if (entry.name !== frontmatter.name) {
				Logger.warn(`Remote skill entry.name "${entry.name}" does not match frontmatter.name "${frontmatter.name}"`)
			}
			return {
				name: frontmatter.name,
				description: frontmatter.description as string,
				alwaysEnabled: entry.alwaysEnabled,
				contents: entry.contents,
			}
		})
		.filter((e): e is NonNullable<typeof e> => e !== null)
}

/** Parse YAML frontmatter from markdown content (shared helper). */
function parseFrontmatter(fileContent: string): { data: Record<string, unknown>; content: string } {
	const result = parseYamlFrontmatter(fileContent)
	if (result.parseError) {
		Logger.warn("Failed to parse YAML frontmatter:", result.parseError)
	}
	return { data: result.data, content: result.body }
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
			Logger.warn(`Permission denied reading skills directory: ${dirPath}`)
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
			Logger.warn(`Skill at ${skillDir} missing required 'name' field`)
			return null
		}
		if (!frontmatter.description || typeof frontmatter.description !== "string") {
			Logger.warn(`Skill at ${skillDir} missing required 'description' field`)
			return null
		}

		// Name must match directory name per spec
		if (frontmatter.name !== skillName) {
			Logger.warn(`Skill name "${frontmatter.name}" doesn't match directory "${skillName}"`)
			return null
		}

		return {
			name: skillName,
			description: frontmatter.description,
			path: skillMdPath,
			source,
		}
	} catch (error) {
		Logger.warn(`Failed to load skill at ${skillDir}:`, error)
		return null
	}
}

/**
 * Discover all skills from global (~/.cline/skills), remote config, and project directories.
 *
 * Precedence (highest wins on name collision via getAvailableSkills):
 *   remote (enterprise) > disk-global (user personal) > project (workspace)
 *
 * This is achieved by the array order + getAvailableSkills iterating in reverse (last wins):
 *   [project..., disk-global..., remote...]
 */
export async function discoverSkills(cwd: string, remoteSkillEntries?: GlobalInstructionsFile[]): Promise<SkillMetadata[]> {
	const skills: SkillMetadata[] = []

	const scanDirs = getSkillsDirectoriesForScan(cwd)

	// Collect project and disk-global skills separately so we can insert remote between them
	const projectSkills: SkillMetadata[] = []
	const diskGlobalSkills: SkillMetadata[] = []

	for (const dir of scanDirs) {
		const dirSkills = await scanSkillsDirectory(dir.path, dir.source)
		if (dir.source === "project") {
			projectSkills.push(...dirSkills)
		} else {
			diskGlobalSkills.push(...dirSkills)
		}
	}

	// Remote skills: validated via parseRemoteSkillEntries and keyed by frontmatter.name.
	const remoteSkills: SkillMetadata[] = parseRemoteSkillEntries(remoteSkillEntries || []).map((entry) => ({
		name: entry.name,
		description: entry.description,
		path: `remote:${entry.name}`,
		source: "global" as const,
	}))

	// Insert in order: project → disk-global → remote
	// getAvailableSkills iterates backwards so remote (last) wins, then disk-global, then project
	skills.push(...projectSkills, ...diskGlobalSkills, ...remoteSkills)

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

export function filterEnabledSkills(skills: SkillMetadata[], toggleState: SkillToggleState = {}): SkillMetadata[] {
	const globalSkillsToggles = toggleState.globalSkillsToggles ?? {}
	const localSkillsToggles = toggleState.localSkillsToggles ?? {}
	const remoteSkillsToggles = toggleState.remoteSkillsToggles ?? {}
	const remoteSkillMap = new Map(
		parseRemoteSkillEntries(toggleState.remoteSkillEntries || []).map((entry) => [entry.name, entry]),
	)

	return skills.filter((skill) => {
		if (skill.path.startsWith("remote:")) {
			const name = skill.path.replace("remote:", "")
			const entry = remoteSkillMap.get(name)
			if (entry?.alwaysEnabled) {
				return true
			}
			return remoteSkillsToggles[name] !== false
		}

		const toggles = skill.source === "global" ? globalSkillsToggles : localSkillsToggles
		return toggles[skill.path] !== false
	})
}

export async function discoverAvailableSkills(cwd: string, toggleState: SkillToggleState = {}): Promise<SkillMetadata[]> {
	const allSkills = await discoverSkills(cwd, toggleState.remoteSkillEntries)
	return filterEnabledSkills(getAvailableSkills(allSkills), toggleState)
}

/**
 * Get full skill content including instructions.
 * For remote skills, pass remoteSkillEntries so content can be loaded without disk I/O.
 */
export async function getSkillContent(
	skillName: string,
	availableSkills: SkillMetadata[],
	remoteSkillEntries?: GlobalInstructionsFile[],
): Promise<SkillContent | null> {
	const skill = availableSkills.find((s) => s.name === skillName)
	if (!skill) return null

	// Remote skills have no file on disk — retrieve content from the provided entries.
	// Try entry.name first (fast path when dashboard is in sync), fall back to frontmatter match.
	if (skill.path.startsWith("remote:")) {
		let entry = (remoteSkillEntries || []).find((e) => e.name === skillName)
		if (!entry) {
			entry = (remoteSkillEntries || []).find((e) => {
				const { data } = parseYamlFrontmatter(e.contents)
				return typeof data.name === "string" && data.name === skillName
			})
		}
		if (!entry) return null
		const { body } = parseYamlFrontmatter(entry.contents)
		return {
			...skill,
			instructions: body.trim(),
		}
	}

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
