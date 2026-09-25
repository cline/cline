import type { ToolResultContent } from "@cline/shared";

/** Keep recovery coordinates aligned with the bytes written to the result file. */
export function serializeToolResultContent(
	content: ToolResultContent["content"],
): string {
	return typeof content === "string"
		? content
		: JSON.stringify(content, null, 2);
}

export function formatToolResultRecoveryNotice(
	path: string,
	original: ToolResultContent["content"],
	preview: ToolResultContent["content"],
): string {
	const full = serializeToolResultContent(original);
	const shortened = serializeToolResultContent(preview);
	let start = 0;
	while (
		start < full.length &&
		start < shortened.length &&
		full[start] === shortened[start]
	)
		start++;
	let end = full.length;
	let previewEnd = shortened.length;
	while (
		end > start &&
		previewEnd > start &&
		full[end - 1] === shortened[previewEnd - 1]
	) {
		end--;
		previewEnd--;
	}
	// Use one enclosing range: separate fields can be shortened independently,
	// and aggregate budgeting can shorten an already-truncated preview again.
	// These are file lines, not embedded newlines escaped inside JSON strings.
	let startLine = 1;
	let endLine = 1;
	for (let index = 0; index < end; index++) {
		if (full[index] !== "\n") continue;
		if (index < start) startLine++;
		if (index < end - 1) endLine++;
	}
	const readInput = JSON.stringify({
		files: [
			{
				path,
				start_line: startLine,
				end_line: Math.min(startLine + 19, endLine),
			},
		],
	});
	return `\n\nFull tool result saved to: ${path}\nOmitted content is within saved-file lines ${startLine}-${endLine} (1-based, inclusive; this range may also include retained content).\nSearch this file for specific terms, or read small line ranges with read_files; start with ${readInput} and page through the range as needed.\nReading the whole file or very long lines may be truncated again. Narrow the range, or use run_commands to extract bounded text or selected JSON fields from long lines.`;
}
