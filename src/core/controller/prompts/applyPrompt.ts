import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Boolean } from "@shared/proto/cline/common"
import type { ApplyPromptRequest } from "@shared/proto/cline/prompts"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from ".."

const RAW_CONTENT_BASE = "https://raw.githubusercontent.com/cline/prompts/main"

/**
 * Maps a proto PromptType number to the target directory and file structure
 * within the workspace.
 *
 * Prompt types and their filesystem locations:
 * - RULE (1):     .clinerules/{name}.md
 * - WORKFLOW (2): .clinerules/workflows/{name}.md
 * - HOOK (3):     .clinerules/hooks/{name}.md
 * - SKILL (4):    .clinerules/skills/{name}/SKILL.md
 */
function getTargetPath(cwd: string, type: number, fileName: string): { directory: string; filePath: string } {
	switch (type) {
		case 2: // PROMPT_TYPE_WORKFLOW
			return {
				directory: path.join(cwd, ".clinerules", "workflows"),
				filePath: path.join(cwd, ".clinerules", "workflows", fileName + ".md"),
			}
		case 3: // PROMPT_TYPE_HOOK
			return {
				directory: path.join(cwd, ".clinerules", "hooks"),
				filePath: path.join(cwd, ".clinerules", "hooks", fileName + ".md"),
			}
		case 4: {
			// PROMPT_TYPE_SKILL - skills use a directory with SKILL.md inside
			const skillDir = path.join(cwd, ".clinerules", "skills", fileName)
			return {
				directory: skillDir,
				filePath: path.join(skillDir, "SKILL.md"),
			}
		}
		case 1: // PROMPT_TYPE_RULE
		default:
			return {
				directory: path.join(cwd, ".clinerules"),
				filePath: path.join(cwd, ".clinerules", fileName + ".md"),
			}
	}
}

/**
 * Maps a proto PromptType number to the source directory path in the prompts repo.
 */
function getRepoPath(type: number, promptId: string): string {
	switch (type) {
		case 2: // PROMPT_TYPE_WORKFLOW
			return `workflows/${promptId}.md`
		case 3: // PROMPT_TYPE_HOOK
			return `hooks/${promptId}.md`
		case 4: // PROMPT_TYPE_SKILL
			return `skills/${promptId}.md`
		case 1: // PROMPT_TYPE_RULE
		default:
			return `.clinerules/${promptId}.md`
	}
}

/**
 * Fetches prompt content from raw.githubusercontent.com (CDN, not rate-limited).
 * Used when the catalog doesn't include file content (centralized API pattern).
 */
async function fetchPromptContent(type: number, promptId: string): Promise<string> {
	const repoPath = getRepoPath(type, promptId)
	const url = `${RAW_CONTENT_BASE}/${repoPath}`
	const response = await axios.get(url, { ...getAxiosSettings(), timeout: 10_000 })
	return typeof response.data === "string" ? response.data : String(response.data)
}

/**
 * Applies a prompt to the workspace by writing it to the appropriate directory.
 * If content is empty (catalog didn't include it), fetches it on-demand from GitHub CDN.
 */
export async function applyPrompt(_controller: Controller, request: ApplyPromptRequest): Promise<Boolean> {
	try {
		const { promptId, type, name } = request
		let { content } = request

		// Get workspace root
		const cwd = await getWorkspacePath()
		if (!cwd) {
			Logger.error("No workspace root available")
			return { value: false }
		}

		// Fetch content on-demand if not provided (centralized API doesn't include file content)
		if (!content) {
			try {
				content = await fetchPromptContent(type, promptId)
			} catch (error) {
				Logger.error(`Error fetching prompt content for ${promptId}:`, error)
				return { value: false }
			}
		}

		// Create kebab-case filename from prompt name or ID
		const fileName = (name || promptId)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")

		const { directory, filePath } = getTargetPath(cwd, type, fileName)

		// Ensure directory exists
		try {
			await fs.mkdir(directory, { recursive: true })
		} catch (error) {
			Logger.error(`Error creating directory ${directory}:`, error)
			return { value: false }
		}

		// Write the file
		try {
			await fs.writeFile(filePath, content, "utf-8")
			Logger.info(`Successfully wrote prompt to ${filePath}`)
			return { value: true }
		} catch (error) {
			Logger.error(`Error writing file ${filePath}:`, error)
			return { value: false }
		}
	} catch (error) {
		Logger.error("Error in applyPrompt:", error)
		return { value: false }
	}
}
