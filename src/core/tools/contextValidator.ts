import { Task } from "../task/Task"
import * as fs from "fs/promises"

/**
 * Conservative buffer percentage for file reading.
 * We use a very conservative estimate to ensure files fit in context.
 */
const FILE_READ_BUFFER_PERCENTAGE = 0.4 // 40% buffer for safety

/**
 * Very conservative character to token ratio
 * Using 2.5 chars per token instead of 3-4 to be extra safe
 */
const CHARS_PER_TOKEN_CONSERVATIVE = 2.5

/**
 * File size thresholds
 */
const TINY_FILE_SIZE = 10 * 1024 // 10KB - always safe
const SMALL_FILE_SIZE = 50 * 1024 // 50KB - safe if context is mostly empty
const MEDIUM_FILE_SIZE = 500 * 1024 // 500KB - needs validation
const LARGE_FILE_SIZE = 1024 * 1024 // 1MB - always limit

export interface ContextValidationResult {
	shouldLimit: boolean
	safeContentLimit: number // Character count limit
	reason?: string
}

/**
 * Simple validation based on file size and available context.
 * Uses very conservative estimates to avoid context overflow.
 */
export async function validateFileSizeForContext(
	filePath: string,
	totalLines: number,
	currentMaxReadFileLine: number,
	cline: Task,
): Promise<ContextValidationResult> {
	try {
		// Get file size
		const stats = await fs.stat(filePath)
		const fileSizeBytes = stats.size

		// Tiny files are always safe
		if (fileSizeBytes < TINY_FILE_SIZE) {
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// Get context information
		const modelInfo = cline.api.getModel().info
		const { contextTokens: currentContextTokens } = cline.getTokenUsage()
		const contextWindow = modelInfo.contextWindow
		const currentlyUsed = currentContextTokens || 0

		// Calculate available space with conservative buffer
		const remainingTokens = contextWindow - currentlyUsed
		const usableTokens = Math.floor(remainingTokens * (1 - FILE_READ_BUFFER_PERCENTAGE))

		// Reserve space for response (use 25% of remaining or 4096, whichever is smaller)
		const responseReserve = Math.min(Math.floor(usableTokens * 0.25), 4096)
		const availableForFile = usableTokens - responseReserve

		// Convert to conservative character estimate
		const safeCharLimit = Math.floor(availableForFile * CHARS_PER_TOKEN_CONSERVATIVE)

		// For small files with mostly empty context, allow full read
		const contextUsagePercent = currentlyUsed / contextWindow
		if (fileSizeBytes < SMALL_FILE_SIZE && contextUsagePercent < 0.3) {
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// For medium files, check if they fit within safe limit
		if (fileSizeBytes < MEDIUM_FILE_SIZE && fileSizeBytes <= safeCharLimit) {
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// For large files or when approaching limits, always limit
		if (fileSizeBytes > safeCharLimit || fileSizeBytes > LARGE_FILE_SIZE) {
			// Use a very conservative limit
			const finalLimit = Math.min(safeCharLimit, 100000) // Cap at 100K chars

			return {
				shouldLimit: true,
				safeContentLimit: finalLimit,
				reason: "This is a partial read - the remaining content cannot be accessed due to context limitations.",
			}
		}

		return { shouldLimit: false, safeContentLimit: -1 }
	} catch (error) {
		// On any error, use ultra-conservative defaults
		console.warn(`[validateFileSizeForContext] Error during validation: ${error}`)
		return {
			shouldLimit: true,
			safeContentLimit: 50000, // 50K chars as safe fallback
			reason: "This is a partial read - the remaining content cannot be accessed due to context limitations.",
		}
	}
}
