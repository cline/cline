const ATTACHED_FILES_LABEL = /(?:^|\n\n)\[attached \d+ files?\]$/;

/** How a sent prompt shows the non-image files that went with it. */
export function withAttachedFilesLabel(
	prompt: string,
	fileCount: number,
): string {
	if (fileCount <= 0) return prompt;
	const label = `[attached ${fileCount} file${fileCount === 1 ? "" : "s"}]`;
	return prompt ? `${prompt}\n\n${label}` : label;
}

export function withoutAttachedFilesLabel(content: string): string {
	return content.replace(ATTACHED_FILES_LABEL, "");
}
