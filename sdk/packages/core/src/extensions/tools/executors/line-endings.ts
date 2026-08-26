import * as os from "node:os";

/**
 * Line-ending normalization for files created from scratch, shared by the
 * file-writing executors (editor, apply_patch). Internal to the executors.
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
