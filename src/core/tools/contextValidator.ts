import { Task } from "../task/Task"
import { readLines } from "../../integrations/misc/read-lines"
import { getModelMaxOutputTokens, getFormatForProvider } from "../../shared/api"
import * as fs from "fs/promises"

/**
 * More aggressive buffer percentage specifically for file reading validation.
 * This is separate from the global TOKEN_BUFFER_PERCENTAGE to provide extra safety
 * when reading files without affecting other context window calculations.
 */
const FILE_READ_BUFFER_PERCENTAGE = 0.25 // 25% buffer for file reads

export interface ContextValidationResult {
	shouldLimit: boolean
	safeMaxLines: number
	reason?: string
}

/**
 * Determines if we should skip the expensive token-based validation.
 * Returns true if we're confident the file can be read without limits.
 * Prioritizes accuracy - only skips when very confident.
 */
async function shouldSkipValidation(filePath: string, totalLines: number, cline: Task): Promise<boolean> {
	// Heuristic 1: Very small files by line count (< 100 lines)
	if (totalLines < 100) {
		console.log(
			`[shouldSkipValidation] Skipping validation for ${filePath} - small line count (${totalLines} lines)`,
		)
		return true
	}

	try {
		// Get file size
		const stats = await fs.stat(filePath)
		const fileSizeBytes = stats.size
		const fileSizeMB = fileSizeBytes / (1024 * 1024)

		// Heuristic 2: Very small files by size (< 5KB) - definitely safe to skip validation
		if (fileSizeBytes < 5 * 1024) {
			console.log(
				`[shouldSkipValidation] Skipping validation for ${filePath} - small file size (${(fileSizeBytes / 1024).toFixed(1)}KB)`,
			)
			return true
		}

		// For larger files, check if context is mostly empty
		const modelInfo = cline.api.getModel().info
		const { contextTokens: currentContextTokens } = cline.getTokenUsage()
		const contextWindow = modelInfo.contextWindow

		// Calculate context usage percentage
		const contextUsagePercent = (currentContextTokens || 0) / contextWindow

		// Heuristic 3: If context is mostly empty (< 50% used) and file is not too big (< 100KB),
		// we can skip validation as there's plenty of room
		if (contextUsagePercent < 0.5 && fileSizeBytes < 100 * 1024) {
			console.log(
				`[validateFileSizeForContext] Skipping validation for ${filePath} - context mostly empty (${Math.round(contextUsagePercent * 100)}% used) and file is moderate size (${fileSizeMB.toFixed(2)}MB)`,
			)
			return true
		}
	} catch (error) {
		// If we can't check file size or context state, don't skip validation
		console.warn(`[validateFileSizeForContext] Could not check file size or context state: ${error}`)
	}

	return false
}

/**
 * Validates if a file can be safely read based on its size and current runtime context state.
 * Uses a 2-phase approach: character-based estimation followed by actual token validation.
 * Returns a safe maxReadFileLine value to prevent context overflow.
 */
export async function validateFileSizeForContext(
	filePath: string,
	totalLines: number,
	currentMaxReadFileLine: number,
	cline: Task,
): Promise<ContextValidationResult> {
	try {
		// Check if we can skip validation
		if (await shouldSkipValidation(filePath, totalLines, cline)) {
			return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
		}

		// Get actual runtime state from the task
		const modelInfo = cline.api.getModel().info
		const { contextTokens: currentContextTokens } = cline.getTokenUsage()
		const contextWindow = modelInfo.contextWindow

		// Get the model-specific max output tokens using the same logic as sliding window
		const modelId = cline.api.getModel().id
		const apiProvider = cline.apiConfiguration.apiProvider
		const settings = await cline.providerRef.deref()?.getState()

		// Use the centralized utility function to get the format
		const format = getFormatForProvider(apiProvider)

		const maxResponseTokens = getModelMaxOutputTokens({ modelId, model: modelInfo, settings, format })

		// Calculate how much context is already used
		const currentlyUsed = currentContextTokens || 0

		// Calculate remaining context space
		const remainingContext = contextWindow - currentlyUsed

		// Apply buffer to the remaining context, not the total context window
		// This gives us a more accurate assessment of what's actually available
		const usableRemainingContext = Math.floor(remainingContext * (1 - FILE_READ_BUFFER_PERCENTAGE))

		// Use the same approach as sliding window: reserve the model's max tokens
		// This ensures consistency across the codebase
		const reservedForResponse = maxResponseTokens || 0

		// Calculate available tokens for file content
		const availableTokensForFile = usableRemainingContext - reservedForResponse

		// Use 90% of available space to leave some margin
		const targetTokenLimit = Math.floor(availableTokensForFile * 0.9)

		// Constants for the 2-phase approach
		const CHARS_PER_TOKEN_ESTIMATE = 3
		const CUTBACK_PERCENTAGE = 0.2 // 20% reduction when over limit
		const READ_BATCH_SIZE = 100 // Read 100 lines at a time for efficiency

		// Phase 1: Read content up to estimated safe character limit
		const estimatedSafeChars = targetTokenLimit * CHARS_PER_TOKEN_ESTIMATE

		let accumulatedContent = ""
		let currentLine = 0
		let lineToCharMap: Map<number, number> = new Map() // Maps line number to character position

		// Track the start position of each line for potential cutback
		lineToCharMap.set(0, 0)

		// Read until we hit our estimated character limit or EOF
		while (currentLine < totalLines && accumulatedContent.length < estimatedSafeChars) {
			const batchEndLine = Math.min(currentLine + READ_BATCH_SIZE - 1, totalLines - 1)

			try {
				const batchContent = await readLines(filePath, batchEndLine, currentLine)

				// Track line positions within the accumulated content
				let localPos = 0
				for (let lineNum = currentLine; lineNum <= batchEndLine; lineNum++) {
					const nextNewline = batchContent.indexOf("\n", localPos)
					if (nextNewline !== -1) {
						lineToCharMap.set(lineNum + 1, accumulatedContent.length + nextNewline + 1)
						localPos = nextNewline + 1
					}
				}

				accumulatedContent += batchContent
				currentLine = batchEndLine + 1
			} catch (error) {
				console.warn(`[validateFileSizeForContext] Error reading batch: ${error}`)
				break
			}
		}

		// Phase 2: Validate with actual API and cutback if needed
		let finalContent = accumulatedContent
		let finalLineCount = currentLine
		let apiCallCount = 0
		const maxApiCalls = 5 // Safety limit to prevent infinite loops

		while (apiCallCount < maxApiCalls) {
			apiCallCount++

			// Make the actual API call to count tokens
			const actualTokens = await cline.api.countTokens([{ type: "text", text: finalContent }])

			console.log(
				`[validateFileSizeForContext] API call ${apiCallCount}: ${actualTokens} tokens for ${finalContent.length} chars (${finalLineCount} lines)`,
			)

			if (actualTokens <= targetTokenLimit) {
				// We're under the limit, we're done!
				break
			}

			// We're over the limit - cut back by 20%
			const targetLength = Math.floor(finalContent.length * (1 - CUTBACK_PERCENTAGE))

			// Find the line that gets us closest to the target length
			let cutoffLine = 0
			for (const [lineNum, charPos] of lineToCharMap.entries()) {
				if (charPos > targetLength) {
					break
				}
				cutoffLine = lineNum
			}

			// Ensure we don't cut back too far
			if (cutoffLine < 10) {
				console.warn(
					`[validateFileSizeForContext] Cutback resulted in too few lines (${cutoffLine}), using minimum`,
				)
				cutoffLine = Math.min(50, totalLines)
			}

			// Get the character position for the cutoff line
			const cutoffCharPos = lineToCharMap.get(cutoffLine) || 0
			finalContent = accumulatedContent.substring(0, cutoffCharPos)
			finalLineCount = cutoffLine

			// Safety check
			if (finalContent.length === 0) {
				return {
					shouldLimit: true,
					safeMaxLines: 10,
					reason: `File too large for available context. Even minimal content exceeds token limit.`,
				}
			}
		}

		// Log final statistics
		console.log(
			`[validateFileSizeForContext] Final: ${finalLineCount} lines, ${finalContent.length} chars, ${apiCallCount} API calls`,
		)

		// Ensure we provide at least a minimum useful amount
		const minUsefulLines = 50
		const finalSafeMaxLines = Math.max(minUsefulLines, finalLineCount)

		// If we read the entire file without exceeding the limit, no limitation needed
		if (finalLineCount >= totalLines) {
			return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
		}

		// If we couldn't read even the minimum useful lines
		if (finalLineCount < minUsefulLines) {
			return {
				shouldLimit: true,
				safeMaxLines: finalSafeMaxLines,
				reason: `Very limited context space. Could only safely read ${finalLineCount} lines before exceeding token limit. Context: ${currentlyUsed}/${contextWindow} tokens used (${Math.round((currentlyUsed / contextWindow) * 100)}%). Limited to ${finalSafeMaxLines} lines. Consider using search_files or line_range for specific sections.`,
			}
		}

		return {
			shouldLimit: true,
			safeMaxLines: finalSafeMaxLines,
			reason: `File exceeds available context space. Safely read ${finalSafeMaxLines} lines out of ${totalLines} total lines. Context usage: ${currentlyUsed}/${contextWindow} tokens (${Math.round((currentlyUsed / contextWindow) * 100)}%). Use line_range to read specific sections.`,
		}
	} catch (error) {
		// If we can't get runtime state, fall back to conservative estimation
		console.warn(`[validateFileSizeForContext] Error accessing runtime state: ${error}`)

		// In error cases, we can't check context state, so use simple file size heuristics
		try {
			const stats = await fs.stat(filePath)
			const fileSizeBytes = stats.size

			// Very small files are safe
			if (fileSizeBytes < 5 * 1024) {
				return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
			}
		} catch (statError) {
			// If we can't even stat the file, proceed with conservative defaults
			console.warn(`[validateFileSizeForContext] Could not stat file: ${statError}`)
		}

		if (totalLines > 10000) {
			return {
				shouldLimit: true,
				safeMaxLines: 1000,
				reason: "Large file detected (>10,000 lines). Limited to 1000 lines to prevent context overflow (runtime state unavailable).",
			}
		}
		return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
	}
}
