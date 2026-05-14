// UTF-16 code units, not UTF-8 bytes — worst-case multi-byte stays under the
// 10 MB provider per-string ceiling.
export const MAX_TOOL_OUTPUT_CHARS = 400 * 1024;

// Reserved so the final output (head + marker + tail) is <= maxSize.
const MARKER_RESERVE = 512;

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function truncateToolOutput(
	content: string,
	maxSize: number = MAX_TOOL_OUTPUT_CHARS,
): string {
	if (typeof content !== "string" || content.length <= maxSize) {
		return content;
	}

	const halfSize = Math.floor(Math.max(0, maxSize - MARKER_RESERVE) / 2);
	const head = content.slice(0, halfSize);
	const tail = content.slice(content.length - halfSize);
	const omitted = content.length - halfSize * 2;

	return `${head}\n\n---\n\n[OUTPUT TRUNCATED: ${formatBytes(content.length)} total; ${formatBytes(omitted)} omitted from the middle. Narrow scope (filters, head/tail/grep, exclude node_modules) to see the missing portion.]\n\n---\n\n${tail}`;
}
