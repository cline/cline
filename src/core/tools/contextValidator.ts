import { Task } from "../task/Task"
import { readPartialContent } from "../../integrations/misc/read-partial-content"
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
const MAX_API_CALLS = 5 // Safety limit to prevent infinite loops
const MIN_USEFUL_CHARS = 1000 // Minimum characters to consider useful

/**
 * File size thresholds for heuristics
 */
const TINY_FILE_SIZE = 5 * 1024 // 5KB - definitely safe to skip validation
const SMALL_FILE_SIZE = 100 * 1024 // 100KB - safe if context is mostly empty
const LARGE_FILE_SIZE = 1024 * 1024 // 1MB - skip tokenizer for speed, use cutback percentage

export interface ContextValidationResult {
	shouldLimit: boolean
	safeContentLimit: number // Always represents character count
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
async function shouldSkipValidation(filePath: string, cline: Task): Promise<boolean> {
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
 * Validates content with actual API and applies cutback if needed
 */
async function validateAndCutbackContent(
	content: string,
	targetTokenLimit: number,
	cline: Task,
): Promise<{ finalContent: string; actualTokens: number; didCutback: boolean }> {
	let finalContent = content
	let apiCallCount = 0
	let actualTokens = 0
	let didCutback = false

	while (apiCallCount < MAX_API_CALLS) {
		apiCallCount++

		// Make the actual API call to count tokens
		actualTokens = await cline.api.countTokens([{ type: "text", text: finalContent }])

		console.log(
			`[validateFileSizeForContext] API call ${apiCallCount}: ${actualTokens} tokens for ${finalContent.length} chars`,
		)

		if (actualTokens <= targetTokenLimit) {
			// We're under the limit, we're done!
			break
		}

		// We're over the limit - cut back by CUTBACK_PERCENTAGE
		const targetLength = Math.floor(finalContent.length * (1 - CUTBACK_PERCENTAGE))

		// Safety check
		if (targetLength === 0 || targetLength === finalContent.length) {
			break
		}

		finalContent = finalContent.substring(0, targetLength)
		didCutback = true
	}

	return { finalContent, actualTokens, didCutback }
}

/**
 * Handles error cases with conservative fallback
 */
async function handleValidationError(
	filePath: string,
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
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// For larger files, apply a conservative character limit
		if (fileSizeBytes > 1024 * 1024) {
			// > 1MB
			return {
				shouldLimit: true,
				safeContentLimit: 50000, // 50K chars as a safe fallback
				reason: "Large file detected. Limited to 50,000 characters to prevent context overflow (runtime state unavailable).",
			}
		}
	} catch (statError) {
		// If we can't even stat the file, proceed with very conservative defaults
		console.warn(`[validateFileSizeForContext] Could not stat file: ${statError}`)
		return {
			shouldLimit: true,
			safeContentLimit: 10000, // 10K chars as ultra-safe fallback
			reason: "Unable to determine file size. Limited to 10,000 characters as a precaution.",
		}
	}

	return { shouldLimit: false, safeContentLimit: -1 }
}

/**
 * Validates if a file can be safely read based on its size and current runtime context state.
 * Uses a 2-phase approach: character-based estimation followed by actual token validation.
 * Returns a safe character limit to prevent context overflow.
 */
export async function validateFileSizeForContext(
	filePath: string,
	totalLines: number,
	currentMaxReadFileLine: number,
	cline: Task,
): Promise<ContextValidationResult> {
	try {
		// Check if we can skip validation
		if (await shouldSkipValidation(filePath, cline)) {
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// Get context information
		const contextInfo = await getContextInfo(cline)

		// Phase 1: Estimate safe character limit based on available tokens
		const estimatedSafeChars = contextInfo.targetTokenLimit * CHARS_PER_TOKEN_ESTIMATE

		// Get file size to check if we need to limit
		const stats = await fs.stat(filePath)
		const fileSizeBytes = stats.size

		// If file is smaller than our estimated safe chars, it should fit
		if (fileSizeBytes <= estimatedSafeChars) {
			console.log(
				`[validateFileSizeForContext] File fits within estimated safe chars (${fileSizeBytes} <= ${estimatedSafeChars})`,
			)
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// File is larger than estimated safe chars, need to validate with actual content
		console.log(
			`[validateFileSizeForContext] File exceeds estimated safe chars (${fileSizeBytes} > ${estimatedSafeChars}), validating with actual content`,
		)

		// Phase 2: Read content up to estimated limit and validate with actual API
		const partialResult = await readPartialContent(filePath, estimatedSafeChars)

		// For large files, skip tokenizer validation for speed and apply clean cutback percentage
		let finalContent: string
		let actualTokens: number
		let didCutback: boolean

		if (fileSizeBytes > LARGE_FILE_SIZE) {
			// Skip tokenizer for speed reasons on large files, apply clean cutback
			const cutbackChars = Math.floor(partialResult.content.length * (1 - CUTBACK_PERCENTAGE))
			finalContent = partialResult.content.substring(0, cutbackChars)
			actualTokens = 0 // Not calculated for large files
			didCutback = cutbackChars < partialResult.content.length

			console.log(
				`[validateFileSizeForContext] Large file (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB) - skipping tokenizer for speed, applying ${Math.round(CUTBACK_PERCENTAGE * 100)}% cutback: ${partialResult.content.length} -> ${finalContent.length} chars`,
			)
		} else {
			// Use tokenizer validation for smaller files
			const validation = await validateAndCutbackContent(
				partialResult.content,
				contextInfo.targetTokenLimit,
				cline,
			)
			finalContent = validation.finalContent
			actualTokens = validation.actualTokens
			didCutback = validation.didCutback
		}

		// Calculate final safe character limit
		const finalSafeChars = finalContent.length

		// Ensure we provide at least a minimum useful amount
		const safeContentLimit = Math.max(MIN_USEFUL_CHARS, finalSafeChars)

		// Log final statistics
		console.log(`[validateFileSizeForContext] Final: ${safeContentLimit} chars, ${actualTokens} tokens`)

		// Special case: if we can't read any meaningful content
		if (safeContentLimit === MIN_USEFUL_CHARS && finalSafeChars < MIN_USEFUL_CHARS) {
			const percentageRead = Math.round((safeContentLimit / fileSizeBytes) * 100)
			return {
				shouldLimit: true,
				safeContentLimit,
				reason: `Very limited context space. Can only read ${safeContentLimit} characters (${percentageRead}% of file). Context: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens used (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%). Consider using search_files or line_range for specific sections.`,
			}
		}

		// If we read the entire file without exceeding the limit, no limitation needed
		if (!didCutback && partialResult.charactersRead === fileSizeBytes) {
			return { shouldLimit: false, safeContentLimit: -1 }
		}

		// Calculate percentage read for the notice
		const percentageRead = Math.round((safeContentLimit / fileSizeBytes) * 100)

		return {
			shouldLimit: true,
			safeContentLimit,
			reason: `File exceeds available context space. Can read ${safeContentLimit} of ${fileSizeBytes} characters (${percentageRead}%). Context usage: ${contextInfo.currentlyUsed}/${contextInfo.contextWindow} tokens (${Math.round((contextInfo.currentlyUsed / contextInfo.contextWindow) * 100)}%).`,
		}
	} catch (error) {
		return handleValidationError(filePath, currentMaxReadFileLine, error)
	}
}
