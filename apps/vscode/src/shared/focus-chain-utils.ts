/**
 * Shared utility functions for focus chain pattern matching
 * Used by both extension and webview
 *  */

/**
 * Checks if a trimmed line matches focus chain item patterns
 * @param line The trimmed line to check
 * @returns true if the line is a focus chain item (- [ ], - [x], or - [X])
 */
export function isFocusChainItem(line: string): boolean {
	return line.startsWith("- [ ]") || line.startsWith("- [x]") || line.startsWith("- [X]")
}
