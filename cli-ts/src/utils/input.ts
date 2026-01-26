/**
 * Input filtering utilities for CLI components
 */

/**
 * Check if input contains mouse escape sequences from terminal mouse tracking.
 * AsciiMotionCli enables mouse tracking which generates sequences like [<35;46;17M
 * These should be filtered out of text input handlers.
 */
export function isMouseEscapeSequence(input: string): boolean {
	// Mouse events look like: [<35;46;17M or contain escape characters
	return input.includes("\x1b") || input.includes("[<") || /\d+;\d+[Mm]/.test(input)
}
