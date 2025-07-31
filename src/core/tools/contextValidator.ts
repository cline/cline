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

/**
 * Constants for the 2-phase validation approach
 */
const CHARS_PER_TOKEN_ESTIMATE = 3
const CUTBACK_PERCENTAGE = 0.2 // 20% reduction when over limit
const READ_BATCH_SIZE = 50 // Read 50 lines at a time for efficiency
const MAX_API_CALLS = 5 // Safety limit to prevent infinite loops
const MIN_USEFUL_LINES = 50 // Minimum lines to consider useful

/**
 * File size thresholds for heuristics
 */
const TINY_FILE_SIZE = 5 * 1024 // 5KB - definitely safe to skip validation
const SMALL_FILE_SIZE = 100 * 1024 // 100KB - safe if context is mostly empty

export interface ContextValidationResult {
	shouldLimit: boolean
	safeMaxLines: number
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
	const reservedForResponse = maxResponseTokens || 0
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
		const fileSizeMB = fileSizeBytes / (1024 * 1024)

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
 * Validates a single-line file (likely minified) to see if it fits in context
 * NOTE: because we cannot chunk lines in file reads, we still cannot handle single-line files that do not fit in context
 */
async function validateSingleLineFile(
	filePath: string,
	cline: Task,
	contextInfo: ContextInfo,
): Promise<ContextValidationResult | null> {
	console.log(`[validateFileSizeForContext] Single-line file detected: ${filePath} - checking if it fits in context`)

	try {
		// Read the entire single line
		const fileContent = await readLines(filePath, 0, 0)

		// Count tokens for the single line
		const actualTokens = await cline.api.countTokens([{ type: "text", text: fileContent }])

		console.log(
			`[validateFileSizeForContext] Single-line file: ${actualTokens} tokens, available: ${contextInfo.targetTokenLimit} tokens`,
		)

		if (actualTokens <= contextInfo.targetTokenLimit) {
			// The single line fits within context
			return { shouldLimit: false, safeMaxLines: -1 }
		} else {
			// Single line is too large for context
			return {
				shouldLimit: true,
				safeMaxLines: 0,
				reason: `Minified file exceeds available context space. The single line contains ${actualTokens} tokens but only ${contextInfo.targetTokenLimit} tokens are available. Context: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens used (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). Consider using search_files to find specific content.`,
			}
		}
	} catch (error) {
		console.warn(`[validateFileSizeForContext] Error processing single-line file: ${error}`)
		return null // Fall through to regular validation
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
 * Validates content with actual API and cuts back if needed
 */
async function validateAndAdjustContent(
	accumulatedContent: string,
	initialLineCount: number,
	lineToCharMap: Map<number, number>,
	targetTokenLimit: number,
	totalLines: number,
	cline: Task,
): Promise<{ finalContent: string; finalLineCount: number }> {
	let finalContent = accumulatedContent
	let finalLineCount = initialLineCount
	let apiCallCount = 0

	while (apiCallCount < MAX_API_CALLS) {
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

		// We're over the limit - cut back by CUTBACK_PERCENTAGE
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
			cutoffLine = Math.min(MIN_USEFUL_LINES, totalLines)
		}

		// Get the character position for the cutoff line
		const cutoffCharPos = lineToCharMap.get(cutoffLine) || 0
		finalContent = accumulatedContent.substring(0, cutoffCharPos)
		finalLineCount = cutoffLine

		// Safety check
		if (finalContent.length === 0) {
			break
		}
	}

	return { finalContent, finalLineCount }
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
	console.warn(`[validateFileSizeForContext] Error accessing runtime state: ${error}`)

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

		// Special handling for single-line files (likely minified)
		if (totalLines === 1) {
			const singleLineResult = await validateSingleLineFile(filePath, cline, contextInfo)
			if (singleLineResult) {
				return singleLineResult
			}
			// Fall through to regular validation if single-line validation failed
		}

		// Phase 1: Read content up to estimated safe character limit
		const estimatedSafeChars = contextInfo.targetTokenLimit * CHARS_PER_TOKEN_ESTIMATE
		const { content, lineCount, lineToCharMap } = await readFileInBatches(filePath, totalLines, estimatedSafeChars)

		// Phase 2: Validate with actual API and cutback if needed
		const { finalContent, finalLineCount } = await validateAndAdjustContent(
			content,
			lineCount,
			lineToCharMap,
			contextInfo.targetTokenLimit,
			totalLines,
			cline,
		)

		// Log final statistics
		console.log(`[validateFileSizeForContext] Final: ${finalLineCount} lines, ${finalContent.length} chars`)

		// Ensure we provide at least a minimum useful amount
		const finalSafeMaxLines = Math.max(MIN_USEFUL_LINES, finalLineCount)

		// If we read the entire file without exceeding the limit, no limitation needed
		if (finalLineCount >= totalLines) {
			return { shouldLimit: false, safeMaxLines: currentMaxReadFileLine }
		}

		// If we couldn't read even the minimum useful lines
		if (finalLineCount < MIN_USEFUL_LINES) {
			return {
				shouldLimit: true,
				safeMaxLines: finalSafeMaxLines,
				reason: `Very limited context space. Could only safely read ${finalLineCount} lines before exceeding token limit. Context: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens used (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). Limited to ${finalSafeMaxLines} lines. Consider using search_files or line_range for specific sections.`,
			}
		}

		return {
			shouldLimit: true,
			safeMaxLines: finalSafeMaxLines,
			reason: `File exceeds available context space. Safely read ${finalSafeMaxLines} lines out of ${totalLines} total lines. Context usage: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). Use line_range to read specific sections.`,
		}
	} catch (error) {
		return handleValidationError(filePath, totalLines, currentMaxReadFileLine, error)
	}
}
