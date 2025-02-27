import fs from "fs/promises"
import path from "path"
import { Mode } from "../../../shared/modes"
import { fileExistsAtPath } from "../../../utils/fs"

/**
 * Safely reads a file, returning an empty string if the file doesn't exist
 */
async function safeReadFile(filePath: string): Promise<string> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		// When reading with "utf-8" encoding, content should be a string
		return content.trim()
	} catch (err) {
		const errorCode = (err as NodeJS.ErrnoException).code
		if (!errorCode || !["ENOENT", "EISDIR"].includes(errorCode)) {
			throw err
		}
		return ""
	}
}

/**
 * Get the path to a system prompt file for a specific mode
 */
export function getSystemPromptFilePath(cwd: string, mode: Mode): string {
	return path.join(cwd, ".roo", `system-prompt-${mode}`)
}

/**
 * Loads custom system prompt from a file at .roo/system-prompt-[mode slug]
 * If the file doesn't exist, returns an empty string
 */
export async function loadSystemPromptFile(cwd: string, mode: Mode): Promise<string> {
	const filePath = getSystemPromptFilePath(cwd, mode)
	return safeReadFile(filePath)
}

/**
 * Ensures the .roo directory exists, creating it if necessary
 */
export async function ensureRooDirectory(cwd: string): Promise<void> {
	const rooDir = path.join(cwd, ".roo")

	// Check if directory already exists
	if (await fileExistsAtPath(rooDir)) {
		return
	}

	// Create the directory
	try {
		await fs.mkdir(rooDir, { recursive: true })
	} catch (err) {
		// If directory already exists (race condition), ignore the error
		const errorCode = (err as NodeJS.ErrnoException).code
		if (errorCode !== "EEXIST") {
			throw err
		}
	}
}
