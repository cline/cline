/**
 * Content size limits to prevent massive files/responses from bricking conversations.
 * 400KB ≈ ~100,000 tokens, which is a reasonable limit for context.
 */

/** Maximum content size in bytes (400KB) */
const MAX_CONTENT_SIZE_BYTES = 400 * 1024

/**
 * Format bytes into a human-readable string (e.g., "1.5 MB", "400 KB").
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Truncate content if it exceeds the maximum size limit.
 * Shows the beginning of the content with a clear truncation notice at the very end.
 *
 * @param content The content to potentially truncate
 * @param maxSize Maximum size in bytes (defaults to MAX_CONTENT_SIZE_BYTES)
 * @returns The original content if under limit, or truncated content with message at end
 */
export function truncateContent(content: string, maxSize: number = MAX_CONTENT_SIZE_BYTES): string {
	const bytes = new TextEncoder().encode(content)
	if (bytes.length <= maxSize) {
		return content
	}

	// Cut at maxSize bytes, then back up off any UTF-8 continuation byte so a
	// multi-byte character (CJK, emoji, ...) is never split. `content.length`
	// is UTF-16 code units, not bytes, so the old code under-counted size for
	// non-ASCII content and the byte limit didn't actually hold.
	let end = maxSize
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
		end--
	}
	const truncatedContent = new TextDecoder().decode(bytes.subarray(0, end))
	const truncatedAmount = bytes.length - end

	return `${truncatedContent}\n\n---\n\n[FILE TRUNCATED: This content is ${formatBytes(bytes.length)} but only the first ${formatBytes(end)} is shown (${formatBytes(truncatedAmount)} truncated). Use search_files to find specific patterns, or execute_command with grep/head/tail for targeted reading.]`
}
