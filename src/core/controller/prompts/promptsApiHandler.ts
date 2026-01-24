import { systemPromptsManager } from "../../prompts/SystemPromptsManager"
import { Logger } from "@/shared/services/Logger"
import { readdir, readFile, writeFile } from "fs/promises"
import path from "node:path"

/**
 * API handler for listing files in prompts directory
 */
export async function listPromptsFiles() {
	try {
		const promptsDir = systemPromptsManager.getPromptsDirectory()
		await systemPromptsManager.ensurePromptsDir()
		const files = await readdir(promptsDir)

		const mdFiles = files.filter((file) => file.endsWith(".md") && file !== "README.md")

		return { files: mdFiles }
	} catch (error) {
		Logger.error("Failed to list prompts files:", error)
		return { files: [] }
	}
}

/**
 * API handler for reading a specific prompt file
 */
export async function getPromptFile(filename: string) {
	try {
		const promptsDir = systemPromptsManager.getPromptsDirectory()
		const filePath = path.resolve(promptsDir, filename)
		
		// Prevent path traversal attacks
		if (!filePath.startsWith(promptsDir + path.sep)) {
			Logger.warn(`Invalid prompt file path detected: ${filename}`)
			return { content: "" }
		}

		const prompts = await systemPromptsManager.scanPrompts(true)
		const prompt = prompts.find((p) => p.filename === filename)

		if (prompt) {
			return { content: prompt.content }
		}

		const content = await readFile(filePath, "utf-8")
		return { content }
	} catch (error) {
		Logger.error(`Failed to read prompt file ${filename}:`, error)
		return { content: "" }
	}
}

/**
 * API handler for updating a prompt file
 */
export async function updatePromptFile(filename: string, content: string) {
	try {
		const promptsDir = systemPromptsManager.getPromptsDirectory()
		const filePath = path.resolve(promptsDir, filename)
		
		// Prevent path traversal attacks
		if (!filePath.startsWith(promptsDir + path.sep)) {
			Logger.warn(`Invalid prompt file path detected: ${filename}`)
			return { success: false, error: "Invalid filename" }
		}

		await writeFile(filePath, content, "utf-8")
		systemPromptsManager.clearCache()

		return { success: true }
	} catch (error) {
		Logger.error(`Failed to update prompt file ${filename}:`, error)
		return { success: false, error: String(error) }
	}
}
