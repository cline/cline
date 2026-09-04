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
	// `content.length` is UTF-16 code units, not bytes, so measuring by it
	// under-counts non-ASCII content and the byte limit wouldn't actually hold.
	// Measure the true UTF-8 size without allocating a buffer for the entire
	// (potentially very large) input first.
	const contentSize = Buffer.byteLength(content, "utf8")
	if (contentSize <= maxSize) {
		return content
	}

	// Encode only the bounded prefix. `Buffer.write` stops before writing a
	// partial UTF-8 character, so a multi-byte character (CJK, emoji, ...) is
	// never split, and we allocate at most `maxSize` bytes regardless of how
	// large the input is (PDF/DOCX/notebook/Excel extraction can be huge).
	const truncatedBuffer = Buffer.allocUnsafe(maxSize)
	const shownSize = truncatedBuffer.write(content, 0, maxSize, "utf8")
	const truncatedContent = truncatedBuffer.toString("utf8", 0, shownSize)
	const truncatedAmount = contentSize - shownSize

	return `${truncatedContent}\n\n---\n\n[FILE TRUNCATED: This content is ${formatBytes(contentSize)} but only the first ${formatBytes(shownSize)} is shown (${formatBytes(truncatedAmount)} truncated). Use search_files to find specific patterns, or execute_command with grep/head/tail for targeted reading.]`
}
