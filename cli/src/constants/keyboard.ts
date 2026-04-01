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

// Option+Backspace / Ctrl+Backspace (delete word backwards) sequences
// Multiple paths cover different terminals:
//   - \x1b\x7f: terminals with "Option as Meta/Esc+" configured
//   - \x08: Ctrl+Backspace on macOS/Linux (detected in enhanced-stdin proxy)
//   - \x1b[27;3;127~: modifyOtherKeys protocol (detected in enhanced-stdin proxy)
//   - \x1b[127;3u: Kitty keyboard protocol
export const OPTION_BACKSPACE_SEQUENCES = new Set([
	"\x1b\x7f", // Meta+DEL - terminals with "Option as Meta/Esc+" configured
	"\x1b\x08", // Meta+BS - some terminals send BS (0x08) instead of DEL (0x7f)
	"\x1b[27;3;127~", // xterm modifyOtherKeys format: Alt+DEL (modifier=3, key=127)
	"\x1b[127;3u", // Kitty keyboard protocol format: DEL with Alt modifier
])

/**
 * Enable xterm modifyOtherKeys mode for detecting modifier keys.
 *
 * By default, many terminals (especially iTerm2 without "Esc+" configured)
 * send identical bytes for Option+Backspace and regular Backspace (\x7f).
 * Enabling modifyOtherKeys level 2 makes the terminal encode modified keys
 * in a distinct format. For example:
 *   Alt+Backspace → \x1b[27;3;127~ (instead of just \x7f)
 *
 * Level 2 is required because level 1 doesn't modify Alt+Backspace (it only
 * modifies keys without existing encodings, and Backspace has one).
 * However, level 2 also modifies Ctrl+C, Ctrl+D, Tab, etc. The stdin proxy
 * in enhanced-stdin.ts translates these back to their original bytes so
 * Ink's input handling and signal handlers continue to work.
 *
 * Terminals that don't support modifyOtherKeys silently ignore the sequence.
 *
 * Note: We also keep Kitty protocol sequences (\x1b[127;3u) in
 * OPTION_BACKSPACE_SEQUENCES for terminals that natively use that protocol.
 */
export function enableEnhancedKeyboardMode(): void {
	// xterm modifyOtherKeys level 2 — all modified keys get CSI encoding.
	// The stdin proxy translates control keys (Ctrl+C, etc.) back to their
	// original bytes so Ink and signal handlers aren't broken.
	process.stdout.write("\x1b[>4;2m")

	// Kitty keyboard protocol (progressive enhancement, flags=1).
	// VSCode terminal (xterm.js) supports this but NOT modifyOtherKeys.
	// With Kitty, modified keys use the format: \x1b[{keycode};{modifier}u
	// e.g. Option+Backspace → \x1b[127;3u, Ctrl+Backspace → \x1b[127;5u
	// Terminals that don't support it silently ignore the sequence.
	process.stdout.write("\x1b[>1u")
}

/**
 * Disable enhanced keyboard mode, restoring default terminal behavior.
 */
export function disableEnhancedKeyboardMode(): void {
	process.stdout.write("\x1b[>4;0m") // disable modifyOtherKeys
	process.stdout.write("\x1b[<u") // disable Kitty keyboard protocol
}
