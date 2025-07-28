import { promises as fs } from "fs"
import { Task } from "../task/Task"
import { readLines } from "../../integrations/misc/read-lines"
import { getModelMaxOutputTokens } from "../../shared/api"

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
 * Validates if a file can be safely read based on its size and current runtime context state.
 * Reads lines incrementally and counts tokens as it goes, stopping when reaching the token limit.
 * Returns a safe maxReadFileLine value to prevent context overflow.
 */
export async function validateFileSizeForContext(
	filePath: string,
	totalLines: number,
	currentMaxReadFileLine: number,
	cline: Task,
): Promise<ContextValidationResult> {
	try {
		// Get actual runtime state from the task
		const modelInfo = cline.api.getModel().info
		const { contextTokens: currentContextTokens } = cline.getTokenUsage()
		const contextWindow = modelInfo.contextWindow

		// Get the model-specific max output tokens using the same logic as sliding window
		const modelId = cline.api.getModel().id
		const apiProvider = cline.apiConfiguration.apiProvider
		const settings = await cline.providerRef.deref()?.getState()

		// Map apiProvider to the format expected by getModelMaxOutputTokens
		let format: "anthropic" | "openai" | "gemini" | "openrouter" | undefined
		if (
			apiProvider === "anthropic" ||
			apiProvider === "bedrock" ||
			apiProvider === "vertex" ||
			apiProvider === "claude-code"
		) {
			format = "anthropic"
		} else if (apiProvider === "openrouter") {
			format = "openrouter"
		} else if (apiProvider === "openai" || apiProvider === "openai-native") {
			format = "openai"
		} else if (apiProvider === "gemini" || apiProvider === "gemini-cli") {
			format = "gemini"
		}

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

		// Now read lines incrementally and count tokens until we reach the limit
		const BATCH_SIZE = 100 // Read 100 lines at a time
		let currentLine = 0
		let totalTokensSoFar = 0
		let safeMaxLines = 0

		// Use 90% of available space to leave some margin
		const targetTokenLimit = Math.floor(availableTokensForFile * 0.9)

		while (currentLine < totalLines && totalTokensSoFar < targetTokenLimit) {
			// Calculate the end line for this batch
			const batchEndLine = Math.min(currentLine + BATCH_SIZE - 1, totalLines - 1)

			try {
				// Read the next batch of lines
				const batchContent = await readLines(filePath, batchEndLine, currentLine)

				// Count tokens for this batch
				const batchTokens = await cline.api.countTokens([{ type: "text", text: batchContent }])

				// Check if adding this batch would exceed our limit
				if (totalTokensSoFar + batchTokens > targetTokenLimit) {
					// This batch would exceed the limit
					// Try to find a more precise cutoff within this batch
					if (batchEndLine - currentLine > 10) {
						// Read smaller chunks to find a more precise cutoff
						const FINE_BATCH_SIZE = 10
						let fineLine = currentLine

						while (fineLine <= batchEndLine && totalTokensSoFar < targetTokenLimit) {
							const fineEndLine = Math.min(fineLine + FINE_BATCH_SIZE - 1, batchEndLine)
							const fineContent = await readLines(filePath, fineEndLine, fineLine)
							const fineTokens = await cline.api.countTokens([{ type: "text", text: fineContent }])

							if (totalTokensSoFar + fineTokens > targetTokenLimit) {
								// Even this fine batch exceeds the limit
								break
							}

							totalTokensSoFar += fineTokens
							safeMaxLines = fineEndLine + 1 // Convert to 1-based line count
							fineLine = fineEndLine + 1
						}
					}
					// Stop processing more batches
					break
				}

				// Add this batch's tokens to our total
				totalTokensSoFar += batchTokens
				safeMaxLines = batchEndLine + 1 // Convert to 1-based line count
				currentLine = batchEndLine + 1
			} catch (error) {
				// If we encounter an error reading a batch, stop here
				break
			}
		}

		// Ensure we provide at least a minimum useful amount
		const minUsefulLines = 50
		const finalSafeMaxLines = Math.max(minUsefulLines, safeMaxLines)

		// If we read the entire file without exceeding the limit, no limitation needed
		if (safeMaxLines >= totalLines) {
			return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
		}

		// If we couldn't read even the minimum useful lines
		if (safeMaxLines < minUsefulLines) {
			return {
				shouldLimit: true,
				safeMaxLines: finalSafeMaxLines,
				reason: `Very limited context space. Could only safely read ${safeMaxLines} lines before exceeding token limit. Context: ${currentlyUsed}/${contextWindow} tokens used (${Math.round((currentlyUsed / contextWindow) * 100)}%). Limited to ${finalSafeMaxLines} lines. Consider using search_files or line_range for specific sections.`,
			}
		}

		return {
			shouldLimit: true,
			safeMaxLines: finalSafeMaxLines,
			reason: `File exceeds available context space. Safely read ${finalSafeMaxLines} lines (${totalTokensSoFar} tokens) out of ${totalLines} total lines. Context usage: ${currentlyUsed}/${contextWindow} tokens (${Math.round((currentlyUsed / contextWindow) * 100)}%). Use line_range to read specific sections.`,
		}
	} catch (error) {
		// If we can't get runtime state, fall back to conservative estimation
		console.warn(`[validateFileSizeForContext] Error accessing runtime state: ${error}`)

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
