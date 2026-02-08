import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Boolean } from "@shared/proto/cline/common"
import type { RemovePromptRequest } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from ".."

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

		const fileExtension = ".md"
		const fullFileName = fileName + fileExtension

		let targetDirectory: string
		if (type === 1) {
			// RULE type (PROMPT_TYPE_RULE = 1) - remove from .clinerules/
			targetDirectory = path.join(cwd, ".clinerules")
		} else {
			// WORKFLOW type (PROMPT_TYPE_WORKFLOW = 2) - remove from workflows/
			targetDirectory = path.join(cwd, "workflows")
		}

		// Delete the file
		const targetPath = path.join(targetDirectory, fullFileName)
		try {
			await fs.unlink(targetPath)
			Logger.info(`Successfully removed prompt from ${targetPath}`)
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
