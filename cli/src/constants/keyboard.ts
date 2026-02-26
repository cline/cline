/**
 * Keyboard escape sequences for terminal input handling.
 *
 * Different terminals send different escape sequences for the same keys.
 * This file consolidates all known sequences to ensure broad compatibility.
 *
 * Note on Ink's useInput limitations:
 * - Ink parses Home/End keys but doesn't expose them in the key object
 * - Ink sets input='' for Home/End (they're in nonAlphanumericKeys)
 * - We use useHomeEndKeys hook to intercept these from raw stdin
 * - Option+arrow sometimes comes as escape sequence, sometimes as key.meta + arrow
 */

// Home key escape sequences from various terminals
export const HOME_SEQUENCES = new Set([
	"\x1b[H", // CSI H - most common (xterm, Terminal.app)
	"\x1b[1~", // CSI 1 ~ - Linux console, some xterms
	"\x1bOH", // SS3 H - xterm application mode
	"\x1b[7~", // rxvt
])

// End key escape sequences from various terminals
export const END_SEQUENCES = new Set([
	"\x1b[F", // CSI F - most common (xterm, Terminal.app)
	"\x1b[4~", // CSI 4 ~ - Linux console, some xterms
	"\x1bOF", // SS3 F - xterm application mode
	"\x1b[8~", // rxvt
])

// Option+Left (move word left) escape sequences
export const OPTION_LEFT_SEQUENCES = new Set([
	"\x1bb", // Meta+b - emacs style
	"\x1b[1;3D", // CSI 1;3 D - xterm with modifiers
])

// Option+Right (move word right) escape sequences
export const OPTION_RIGHT_SEQUENCES = new Set([
	"\x1bf", // Meta+f - emacs style
	"\x1b[1;3C", // CSI 1;3 C - xterm with modifiers
])
