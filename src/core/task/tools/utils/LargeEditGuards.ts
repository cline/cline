export const MAX_FILE_EDIT_CONTENT_BYTES = 1024 * 1024 // 1MB
export const MAX_FILE_EDIT_LINE_BYTES = 200 * 1024 // 200KB per line
export const MAX_FILE_EDIT_DISPLAY_BYTES = 64 * 1024 // 64KB for tool approval/result payloads

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getLargestLineBytes(content: string): number {
	let largest = 0
	for (const line of content.split("\n")) {
		const bytes = Buffer.byteLength(line, "utf8")
		if (bytes > largest) {
			largest = bytes
		}
	}
	return largest
}

export function validateFileEditSafety(
	content: string,
	{
		relPath,
		operation,
		maxContentBytes = MAX_FILE_EDIT_CONTENT_BYTES,
		maxLineBytes = MAX_FILE_EDIT_LINE_BYTES,
	}: {
		relPath: string
		operation: string
		maxContentBytes?: number
		maxLineBytes?: number
	},
): void {
	const contentBytes = Buffer.byteLength(content, "utf8")
	if (contentBytes > maxContentBytes) {
		throw new Error(
			`Refusing to ${operation} '${relPath}' because the edit payload is too large for safe in-extension editing ` +
				`(${formatBytes(contentBytes)} > ${formatBytes(maxContentBytes)}). ` +
				`Break the change into smaller edits, edit a narrower region, or use a more incremental strategy.`,
		)
	}

	const largestLineBytes = getLargestLineBytes(content)
	if (largestLineBytes > maxLineBytes) {
		throw new Error(
			`Refusing to ${operation} '${relPath}' because at least one line is too large for safe in-extension editing ` +
				`(${formatBytes(largestLineBytes)} > ${formatBytes(maxLineBytes)}). ` +
				`Split the edit into smaller line-oriented changes or use a different strategy for giant single-line content.`,
		)
	}
}

export function getSafeEditDisplayContent(
	content: string | undefined,
	{
		relPath,
		context,
		maxDisplayBytes = MAX_FILE_EDIT_DISPLAY_BYTES,
		maxLineBytes = MAX_FILE_EDIT_LINE_BYTES,
	}: {
		relPath: string
		context: string
		maxDisplayBytes?: number
		maxLineBytes?: number
	},
): { text: string | undefined; wasSummarized: boolean } {
	if (content === undefined) {
		return { text: undefined, wasSummarized: false }
	}

	const contentBytes = Buffer.byteLength(content, "utf8")
	const largestLineBytes = getLargestLineBytes(content)
	if (contentBytes <= maxDisplayBytes && largestLineBytes <= maxLineBytes) {
		return { text: content, wasSummarized: false }
	}

	return {
		text:
			`[${context} for '${relPath}' omitted from tool payload: total size ${formatBytes(contentBytes)}, ` +
			`largest line ${formatBytes(largestLineBytes)}. Review the editor diff or saved file for full content.]`,
		wasSummarized: true,
	}
}
