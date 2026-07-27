export interface PastedTextSnippet {
	marker: string;
	text: string;
}

export const LARGE_PASTE_LINE_THRESHOLD = 5;

const PREVIEW_MAX_CHARS = 48;

export function countPastedTextLines(text: string): number {
	if (text.length === 0) return 0;
	const lines = text.split(/\r\n|\r|\n/);
	return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

export function shouldCompactPastedText(text: string): boolean {
	return countPastedTextLines(text) >= LARGE_PASTE_LINE_THRESHOLD;
}

function previewText(text: string): string {
	const normalized = text.trim().replace(/\s+/g, " ");
	if (!normalized) return "";
	return normalized.length > PREVIEW_MAX_CHARS
		? normalized.slice(0, PREVIEW_MAX_CHARS).trimEnd()
		: normalized;
}

export function formatPastedTextSnippetMarker(text: string): string {
	const lineCount = countPastedTextLines(text);
	const preview = previewText(text);
	const lineLabel = lineCount === 1 ? "line" : "lines";
	const prefix = preview ? `${preview}... ` : "";
	return `[${prefix}Pasted +${lineCount} ${lineLabel}]`;
}

export function createUniquePastedTextSnippetMarker(
	text: string,
	existingMarkers: Iterable<string>,
): string {
	const base = formatPastedTextSnippetMarker(text);
	const existing = new Set(existingMarkers);
	if (!existing.has(base)) return base;

	for (let suffix = 2; ; suffix += 1) {
		const candidate = base.replace(/\]$/, ` #${suffix}]`);
		if (!existing.has(candidate)) return candidate;
	}
}

export function expandPastedTextSnippets(
	text: string,
	snippets: readonly PastedTextSnippet[],
): string {
	let expanded = text;
	for (const snippet of snippets) {
		if (!expanded.includes(snippet.marker)) continue;
		expanded = expanded.split(snippet.marker).join(snippet.text);
	}
	return expanded;
}
