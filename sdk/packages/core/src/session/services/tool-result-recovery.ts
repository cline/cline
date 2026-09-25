import type { ToolResultContent } from "@cline/shared";

/** Keep recovery coordinates aligned with the bytes written to the result file. */
export function serializeToolResultContent(
	content: ToolResultContent["content"],
): string {
	return typeof content === "string"
		? content
		: JSON.stringify(content, null, 2);
}

export function annotateToolResultTruncation(
	original: ToolResultContent["content"],
	preview: ToolResultContent["content"],
): ToolResultContent["content"] {
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
	const annotate = (value: unknown): unknown => {
		if (typeof value === "string") {
			return value.replace(
				/\.\.\.\[truncated (\d+ chars(?: to fit provider request budget)?)\]\.\.\./g,
				(_marker, detail: string) =>
					`...[truncated ${detail}; omitted content within saved-file lines ${startLine}-${endLine}]...`,
			);
		}
		if (Array.isArray(value)) return value.map(annotate);
		if (value !== null && typeof value === "object") {
			// Do not rewrite binary image data.
			if ((value as { type?: string }).type === "image") return value;
			return Object.fromEntries(
				Object.entries(value).map(([key, entry]) => [key, annotate(entry)]),
			);
		}
		return value;
	};
	return annotate(preview) as ToolResultContent["content"];
}
