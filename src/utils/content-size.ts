import { stat } from "fs/promises"

// Rough approximation: 1 token ≈ 2 characters for English text
const CHARS_PER_TOKEN = 2

export interface SizeEstimate {
	bytes: number
	estimatedTokens: number
	wouldExceedLimit: boolean
}

/**
 * Estimates tokens from byte count using a simple character ratio
 * This is a rough approximation - actual token count may vary
 */
export function estimateTokens(bytes: number): number {
	return Math.ceil(bytes / CHARS_PER_TOKEN)
}

/**
 * Checks if the given byte count would exceed the size limit
 * More efficient than creating a buffer just to check size
 */
export function wouldExceedSizeLimit(byteCount: number, maxAllowedSize: number): boolean {
	const estimatedTokenCount = estimateTokens(byteCount)
	console.debug(`[WOULD_EXCEED_SIZE_CHECK] Estimated Token Count: ${estimatedTokenCount} tokens`)
	return estimatedTokenCount >= maxAllowedSize
}

/**
 * Estimates size metrics for a string or buffer without loading entire content
 */
export function estimateContentSize(content: string | Buffer, contextLimit: number): SizeEstimate {
	const bytes = Buffer.isBuffer(content) ? content.length : Buffer.from(content).length
	const estimatedTokenCount = estimateTokens(bytes)

	return {
		bytes,
		estimatedTokens: estimatedTokenCount,
		wouldExceedLimit: estimatedTokenCount >= getMaxAllowedSize(contextLimit),
	}
}

/**
 * Gets size metrics for a file without reading its contents
 */
export async function estimateFileSize(filePath: string, contextLimit: number): Promise<SizeEstimate> {
	const stats = await stat(filePath)
	const bytes = stats.size
	const estimatedTokenCount = estimateTokens(bytes)

	return {
		bytes,
		estimatedTokens: estimatedTokenCount,
		wouldExceedLimit: estimatedTokenCount >= getMaxAllowedSize(contextLimit),
	}
}

/**
 * Gets the maximum allowed size for the API context window
 */
export function getMaxAllowedSize(contextWindow: number): number {
	// Get context window and used context from API model
	let maxAllowedSize: number
	switch (contextWindow) {
		case 64_000: // deepseek models
			maxAllowedSize = contextWindow - 27_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models
			maxAllowedSize = contextWindow - 40_000
			break
		default:
			maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8)
	}
	return maxAllowedSize
}
