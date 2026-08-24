/**
 * Line-ending helpers shared by the file-writing executors (editor,
 * apply_patch). Internal to the executors — not part of the public API.
 *
 * Models emit LF-only text regardless of platform (reads strip "\r", so they
 * never even see a file's CRLF endings). Existing files keep their own EOL,
 * detected via detectLineEnding; a file created from scratch has no EOL to
 * preserve, so it gets the platform-native line ending
 * (github.com/cline/cline/issues/13504).
 */

import * as os from "node:os";

export type LineEnding = "\r\n" | "\n";

/**
 * Returns "\r\n" if "\r\n" appears anywhere in the content, otherwise "\n" —
 * including for content with no line breaks at all. Files are uniformly CRLF
 * or uniformly LF in practice; the mixed case that matters is a CRLF file
 * with LF-only lines inserted by earlier releases of these tools, and any
 * surviving "\r\n" — wherever it sits — should pull such a file back to
 * CRLF, which is why this checks for "\r\n" anywhere rather than looking at
 * the first line break.
 */
export function detectLineEnding(content: string): LineEnding {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

export function normalizeLineEndings(text: string, eol: LineEnding): string {
	return text.split(/\r\n|\n/).join(eol);
}

/**
 * Normalizes content for a file created from scratch: the platform-native
 * EOL (CRLF on Windows, LF elsewhere), unless the content already contains a
 * "\r\n" — that explicitly chose CRLF and stays CRLF on every platform. On
 * LF platforms with LF content this is an exact no-op. The `eol` parameter
 * is a test seam; production callers use the platform default.
 */
export function normalizeNewFileContent(
	content: string,
	eol: LineEnding = os.EOL === "\r\n" ? "\r\n" : "\n",
): string {
	return normalizeLineEndings(
		content,
		detectLineEnding(content) === "\r\n" ? "\r\n" : eol,
	);
}
