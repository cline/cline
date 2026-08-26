import * as os from "node:os";

/**
 * Line-ending helpers shared by the file-writing executors (editor,
 * apply_patch). Internal to the executors.
 *
 * Models emit LF-only text (reads strip "\r", so they never see a file's
 * CRLF endings). Existing files keep their own detected EOL, but a new file
 * has no EOL to preserve: use CRLF on Windows unless the content already
 * contains a "\r" and thereby chose its own endings
 * (github.com/cline/cline/issues/13504). No-op on LF platforms.
 */
export function normalizeNewFileLineEndings(content: string): string {
	if (os.EOL === "\r\n" && !content.includes("\r")) {
		return content.replaceAll("\n", "\r\n");
	}
	return content;
}

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
