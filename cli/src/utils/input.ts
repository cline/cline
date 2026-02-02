/**
 * Input filtering utilities for CLI components
 */

/**
 * Check if input contains mouse escape sequences from terminal mouse tracking.
 * AsciiMotionCli enables mouse tracking which generates sequences like [<35;46;17M
 * These should be filtered out of text input handlers.
 *
 * NOTE: This must NOT filter keyboard escape sequences like Option+arrow keys.
 * Mouse sequences have specific patterns with coordinates (e.g., [<35;46;17M).
 */
export function isMouseEscapeSequence(input: string): boolean {
	// Mouse events look like: \x1b[<35;46;17M (SGR mouse format)
	// They contain [< followed by numbers, semicolons, and end with M or m
	return input.includes("[<") && /\[<\d+;\d+;\d+[Mm]/.test(input)
}
