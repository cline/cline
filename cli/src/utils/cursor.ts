/**
 * Cursor movement utilities for multi-line text input
 */

/**
 * Move cursor up one line, preserving column position where possible
 */
export function moveCursorUp(text: string, cursorPos: number): number {
	const textBeforeCursor = text.slice(0, cursorPos)
	const lastNewline = textBeforeCursor.lastIndexOf("\n")

	if (lastNewline === -1) {
		// Already on first line, move to start
		return 0
	}

	const currentCol = cursorPos - lastNewline - 1
	const prevLineStart = textBeforeCursor.lastIndexOf("\n", lastNewline - 1) + 1
	const prevLineLength = lastNewline - prevLineStart
	const newCol = Math.min(currentCol, prevLineLength)

	return prevLineStart + newCol
}

/**
 * Move cursor down one line, preserving column position where possible
 */
export function moveCursorDown(text: string, cursorPos: number): number {
	const textBeforeCursor = text.slice(0, cursorPos)
	const lastNewline = textBeforeCursor.lastIndexOf("\n")
	const currentCol = lastNewline === -1 ? cursorPos : cursorPos - lastNewline - 1
	const nextNewline = text.indexOf("\n", cursorPos)

	if (nextNewline === -1) {
		// Already on last line, move to end
		return text.length
	}

	const nextLineStart = nextNewline + 1
	const nextLineEnd = text.indexOf("\n", nextLineStart)
	const nextLineLength = nextLineEnd === -1 ? text.length - nextLineStart : nextLineEnd - nextLineStart
	const newCol = Math.min(currentCol, nextLineLength)

	return nextLineStart + newCol
}
