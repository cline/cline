import { Task } from "../task/Task"
import { readLines } from "../../integrations/misc/read-lines"
import { readPartialSingleLineContent } from "../../integrations/misc/read-partial-content"
import { getModelMaxOutputTokens, getFormatForProvider } from "../../shared/api"
import * as fs from "fs/promises"

/**
 * More aggressive buffer percentage specifically for file reading validation.
 * This is separate from the global TOKEN_BUFFER_PERCENTAGE to provide extra safety
 * when reading files without affecting other context window calculations.
 */
const FILE_READ_BUFFER_PERCENTAGE = 0.25 // 25% buffer for file reads
const CHARS_PER_TOKEN_ESTIMATE = 3
const READ_BATCH_SIZE = 50 // Read 50 lines at a time for efficiency
const MIN_USEFUL_LINES = 50 // Minimum lines to consider useful

/**
 * File size thresholds for heuristics
 */
const TINY_FILE_SIZE = 5 * 1024 // 5KB - definitely safe to skip validation
const SMALL_FILE_SIZE = 100 * 1024 // 100KB - safe if context is mostly empty

export interface ContextValidationResult {
	shouldLimit: boolean
	safeMaxLines: number // For single-line files, this represents character count; for multi-line files, it's line count
	reason?: string
}

interface ContextInfo {
	currentlyUsed: number
	contextWindow: number
	availableTokensForFile: number
	targetTokenLimit: number
}

/**
 * Gets runtime context information from the task
 */
async function getContextInfo(cline: Task): Promise<ContextInfo> {
	const modelInfo = cline.api.getModel().info
	const { contextTokens: currentContextTokens } = cline.getTokenUsage()
	const contextWindow = modelInfo.contextWindow

	// Get the model-specific max output tokens
	const modelId = cline.api.getModel().id
	const apiProvider = cline.apiConfiguration.apiProvider
	const settings = await cline.providerRef.deref()?.getState()
	const format = getFormatForProvider(apiProvider)
	const maxResponseTokens = getModelMaxOutputTokens({ modelId, model: modelInfo, settings, format })

	// Calculate available space
	const currentlyUsed = currentContextTokens || 0
	const remainingContext = contextWindow - currentlyUsed
	const usableRemainingContext = Math.floor(remainingContext * (1 - FILE_READ_BUFFER_PERCENTAGE))
	const reservedForResponse = Math.min(maxResponseTokens || 0, usableRemainingContext)
	const availableTokensForFile = usableRemainingContext - reservedForResponse
	const targetTokenLimit = Math.floor(availableTokensForFile * 0.9)

	return {
		currentlyUsed,
		contextWindow,
		availableTokensForFile,
		targetTokenLimit,
	}
}

/**
 * Determines if we should skip the expensive token-based validation.
 * Returns true if we're confident the file can be read without limits.
 * Prioritizes accuracy - only skips when very confident.
 */
async function shouldSkipValidation(filePath: string, totalLines: number, cline: Task): Promise<boolean> {
	try {
		// Get file size
		const stats = await fs.stat(filePath)
		const fileSizeBytes = stats.size

		// Very small files by size are definitely safe to skip validation
		if (fileSizeBytes < TINY_FILE_SIZE) {
			console.log(
				`[shouldSkipValidation] Skipping validation for ${filePath} - small file size (${(fileSizeBytes / 1024).toFixed(1)}KB)`,
			)
			return true
		}

		// For larger files, check if context is mostly empty
		const modelInfo = cline.api.getModel().info
		const { contextTokens: currentContextTokens } = cline.getTokenUsage()
		const contextWindow = modelInfo.contextWindow
		const contextUsagePercent = (currentContextTokens || 0) / contextWindow

		// If context is mostly empty (< 50% used) and file is not too big,
		// we can skip validation as there's plenty of room
		if (contextUsagePercent < 0.5 && fileSizeBytes < SMALL_FILE_SIZE) {
			console.log(
				`[shouldSkipValidation] Skipping validation for ${filePath} - context mostly empty (${Math.round(contextUsagePercent * 100)}% used) and file is moderate size`,
			)
			return true
		}
	} catch (error) {
		// If we can't check file size or context state, don't skip validation
		console.warn(`[shouldSkipValidation] Could not check file size or context state: ${error}`)
	}

	return false
}

/**
 * Detects if a file is effectively a single-line file (1-5 lines with only one non-empty line)
 * This handles cases where minified files might have a few empty lines but are essentially single-line
 */
async function isEffectivelySingleLine(filePath: string, totalLines: number): Promise<boolean> {
	// Only check files with 1-5 lines
	if (totalLines < 1 || totalLines > 5) {
		return false
	}

	// Single line files are always effectively single line
	if (totalLines === 1) {
		return true
	}

	try {
		// Check if file is big (>100KB) and lines 2-5 are empty
		const stats = await fs.stat(filePath)
		const fileSizeBytes = stats.size

		// Only apply this logic to big files
		if (fileSizeBytes < 100 * 1024) {
			// Less than 100KB
			return false
		}

		// Read all lines to check if lines 2-5 are empty
		const content = await readLines(filePath, totalLines - 1, 0)
		const lines = content.split("\n")

		// Check if lines 2-5 (indices 1-4) are empty
		let hasEmptyLines2to5 = true
		for (let i = 1; i < Math.min(lines.length, 5); i++) {
			if (lines[i].trim().length > 0) {
				hasEmptyLines2to5 = false
				break
			}
		}

		console.log(
			`[isEffectivelySingleLine] File ${filePath}: totalLines=${totalLines}, fileSize=${(fileSizeBytes / 1024).toFixed(1)}KB, hasEmptyLines2to5=${hasEmptyLines2to5}`,
		)

		return hasEmptyLines2to5
	} catch (error) {
		console.warn(`[isEffectivelySingleLine] Error checking file ${filePath}: ${error}`)
		return false
	}
}

/**
 * Validates a single-line file (likely minified) to see if it fits in context
 * Uses only heuristic estimation without actual token counting
 */
async function validateSingleLineFile(
	filePath: string,
	cline: Task,
	contextInfo: ContextInfo,
): Promise<ContextValidationResult | null> {
	try {
		// Use char heuristic to estimate safe content size with additional safety margin
		const estimatedSafeChars = contextInfo.targetTokenLimit * CHARS_PER_TOKEN_ESTIMATE

		// Read only up to the limited chars to avoid loading huge files into memory
		const partialContent = await readPartialSingleLineContent(filePath, estimatedSafeChars)

		// Get the full file size to determine if we read the entire file
		const stats = await fs.stat(filePath)
		const fullFileSize = stats.size
		const isPartialRead = partialContent.length < fullFileSize

		if (!isPartialRead) {
			// The entire single line fits
			return { shouldLimit: false, safeMaxLines: -1 }
		} else if (partialContent.length > 0) {
			// Only a portion of the line fits
			const percentageRead = Math.round((partialContent.length / fullFileSize) * 100)

			return {
				shouldLimit: true,
				safeMaxLines: partialContent.length, // Return actual character count for single-line files
				reason: `Large single-line file (likely minified) exceeds available context space. Only the first ${percentageRead}% (${partialContent.length} of ${fullFileSize} characters) can be loaded. Context: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens used (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). This is a hard limit - no additional content from this file can be accessed.`,
			}
		} else {
			// Can't fit any content
			return {
				shouldLimit: true,
				safeMaxLines: 0,
				reason: `Single-line file is too large to read any portion within available context space. The file would require more than ${contextInfo.targetTokenLimit} tokens, but context is already ${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}% full (${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens used). This file cannot be accessed.`,
			}
		}
	} catch (error) {
		// Check for specific error types that indicate memory issues
		if (error instanceof Error) {
			const errorMessage = error.message.toLowerCase()
			if (
				errorMessage.includes("heap") ||
				errorMessage.includes("memory") ||
				errorMessage.includes("allocation")
			) {
				// Return a safe fallback instead of crashing
				return {
					shouldLimit: true,
					safeMaxLines: 0,
					reason: `File is too large to process due to memory constraints. Error: ${error.message}. This file cannot be accessed.`,
				}
			}
		}

		return null // Fall through to regular validation for other errors
	}
}

/**
 * Reads file content in batches up to the estimated safe character limit
 */
async function readFileInBatches(
	filePath: string,
	totalLines: number,
	estimatedSafeChars: number,
): Promise<{ content: string; lineCount: number; lineToCharMap: Map<number, number> }> {
	let accumulatedContent = ""
	let currentLine = 0
	const lineToCharMap: Map<number, number> = new Map()

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

	return { content: accumulatedContent, lineCount: currentLine, lineToCharMap }
}

/**
 * Handles error cases with conservative fallback
 */
async function handleValidationError(
	filePath: string,
	totalLines: number,
	currentMaxReadFileLine: number,
	error: unknown,
): Promise<ContextValidationResult> {
	// In error cases, we can't check context state, so use simple file size heuristics
	try {
		const stats = await fs.stat(filePath)
		const fileSizeBytes = stats.size

		// Very small files are safe
		if (fileSizeBytes < TINY_FILE_SIZE) {
			return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
		}
	} catch (statError) {
		// If we can't even stat the file, proceed with conservative defaults
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

		// Get context information
		const contextInfo = await getContextInfo(cline)

		// Special handling for single-line files (likely minified) or effectively single-line files
		const isEffSingleLine = await isEffectivelySingleLine(filePath, totalLines)
		if (isEffSingleLine) {
			const singleLineResult = await validateSingleLineFile(filePath, cline, contextInfo)
			if (singleLineResult) {
				return singleLineResult
			}
			// Fall through to regular validation if single-line validation failed
		}

		// Read content up to estimated safe character limit
		const estimatedSafeChars = contextInfo.targetTokenLimit * CHARS_PER_TOKEN_ESTIMATE
		console.log(`[validateFileSizeForContext] Estimated safe chars for ${filePath}: ${estimatedSafeChars}`)

		const { content, lineCount } = await readFileInBatches(filePath, totalLines, estimatedSafeChars)
		console.log(`[validateFileSizeForContext] Read ${lineCount} lines (${content.length} chars) from ${filePath}`)

		// If we read the entire file without hitting the character limit, no limitation needed
		if (lineCount >= totalLines) {
			console.log(`[validateFileSizeForContext] Read entire file ${filePath} without hitting limit`)
			return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
		}

		// We hit the character limit before reading all lines
		// Ensure we provide at least a minimum useful amount
		const finalSafeMaxLines = Math.max(MIN_USEFUL_LINES, lineCount)
		console.log(
			`[validateFileSizeForContext] Hit character limit for ${filePath}: lineCount=${lineCount}, finalSafeMaxLines=${finalSafeMaxLines}`,
		)

		// If we couldn't read even the minimum useful lines
		if (lineCount < MIN_USEFUL_LINES) {
			const result = {
				shouldLimit: true,
				safeMaxLines: finalSafeMaxLines,
				reason: `Very limited context space. Could only safely read ${lineCount} lines before exceeding token limit. Context: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens used (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). Limited to ${finalSafeMaxLines} lines. Consider using search_files or line_range for specific sections.`,
			}
			console.log(`[validateFileSizeForContext] Returning very limited context result for ${filePath}:`, result)
			return result
		}

		const result = {
			shouldLimit: true,
			safeMaxLines: finalSafeMaxLines,
			reason: `File exceeds available context space. Safely read ${finalSafeMaxLines} lines out of ${totalLines} total lines. Context usage: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). Use line_range to read specific sections.`,
		}
		console.log(`[validateFileSizeForContext] Returning limited context result for ${filePath}:`, result)
		return result
	} catch (error) {
		return handleValidationError(filePath, totalLines, currentMaxReadFileLine, error)
	}
}
