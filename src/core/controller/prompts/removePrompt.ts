import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Boolean } from "@shared/proto/cline/common"
import type { RemovePromptRequest } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from ".."

/**
 * Returns the filesystem path for a prompt based on its type.
 *
 * Prompt types and their filesystem locations:
 * - RULE (1):     .clinerules/{name}.md
 * - WORKFLOW (2): .clinerules/workflows/{name}.md
 * - HOOK (3):     .clinerules/hooks/{name}.md
 * - SKILL (4):    .clinerules/skills/{name}/SKILL.md
 */
function getTargetPath(cwd: string, type: number, fileName: string): string {
	switch (type) {
		case 2: // PROMPT_TYPE_WORKFLOW
			return path.join(cwd, ".clinerules", "workflows", fileName + ".md")
		case 3: // PROMPT_TYPE_HOOK
			return path.join(cwd, ".clinerules", "hooks", fileName + ".md")
		case 4: // PROMPT_TYPE_SKILL
			return path.join(cwd, ".clinerules", "skills", fileName, "SKILL.md")
		case 1: // PROMPT_TYPE_RULE
		default:
			return path.join(cwd, ".clinerules", fileName + ".md")
	}
}

/**
 * Removes a prompt from the workspace by deleting it from the appropriate directory
 */
export async function removePrompt(_controller: Controller, request: RemovePromptRequest): Promise<Boolean> {
	try {
		const { promptId, type, name } = request

		// Get workspace root
		const cwd = await getWorkspacePath()
		if (!cwd) {
			Logger.error("No workspace root available")
			return { value: false }
		}

		// Create kebab-case filename from prompt name or ID
		const fileName = (name || promptId)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")

		const targetPath = getTargetPath(cwd, type, fileName)

		// Delete the file
		try {
			await fs.unlink(targetPath)
			Logger.info(`Successfully removed prompt from ${targetPath}`)

			// For skills, also try to remove the now-empty skill directory
			if (type === 4) {
				const skillDir = path.dirname(targetPath)
				try {
					await fs.rmdir(skillDir) // Only removes if empty
				} catch {
					// Directory not empty or doesn't exist, ignore
				}
			}

			return { value: true }
		} catch (error) {
			// File might not exist, log but don't fail completely
			Logger.error(`Error removing file ${targetPath}:`, error)
			return { value: false }
		}
	} catch (error) {
		Logger.error("Error in removePrompt:", error)
		return { value: false }
	}
}
