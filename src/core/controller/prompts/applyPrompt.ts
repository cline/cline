import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Boolean } from "@shared/proto/cline/common"
import type { ApplyPromptRequest } from "@shared/proto/cline/prompts"
import { Logger } from "@/shared/services/Logger"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from ".."

/**
 * Applies a prompt to the workspace by writing it to the appropriate directory
 */
export async function applyPrompt(_controller: Controller, request: ApplyPromptRequest): Promise<Boolean> {
	try {
		const { promptId, type, content, name } = request

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
			// RULE type (PROMPT_TYPE_RULE = 1) - save to .clinerules/
			targetDirectory = path.join(cwd, ".clinerules")
		} else {
			// WORKFLOW type (PROMPT_TYPE_WORKFLOW = 2) - save to workflows/
			targetDirectory = path.join(cwd, "workflows")
		}

		// Ensure directory exists
		try {
			await fs.mkdir(targetDirectory, { recursive: true })
		} catch (error) {
			Logger.error(`Error creating directory ${targetDirectory}:`, error)
			return { value: false }
		}

		// Write the file
		const targetPath = path.join(targetDirectory, fullFileName)
		try {
			await fs.writeFile(targetPath, content, "utf-8")
			Logger.info(`Successfully wrote prompt to ${targetPath}`)

			// TODO: Update toggle state for the rule/workflow
			// This would require reading the current toggles and setting the new one to true
			// For now, we'll let the user manually enable it if needed

			return { value: true }
		} catch (error) {
			Logger.error(`Error writing file ${targetPath}:`, error)
			return { value: false }
		}
	} catch (error) {
		Logger.error("Error in applyPrompt:", error)
		return { value: false }
	}
}
