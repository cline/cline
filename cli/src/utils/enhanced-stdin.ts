/**
 * Enhanced stdin proxy for intercepting modified key sequences.
 *
 * When xterm modifyOtherKeys mode (level 2) is enabled, terminals send
 * distinct escape sequences for ALL modifier+key combos. For example:
 *   Alt+Backspace → \x1b[27;3;127~
 *   Ctrl+C        → \x1b[27;5;99~
 *
 * This is great for distinguishing Alt+Backspace from Backspace, but it
 * breaks Ink's handling of Ctrl+C, Ctrl+D, Tab, etc. since Ink expects
 * the traditional byte encodings (\x03, \x04, \x09).
 *
 * This module provides a PassThrough stream that sits between real stdin
 * and Ink, translating modifyOtherKeys sequences back to their traditional
 * encodings — except for Alt+Backspace which gets emitted as an event.
 */

import { EventEmitter } from "events"
import { PassThrough } from "stream"

/** Event emitter for enhanced key events that were intercepted from stdin */
export const enhancedKeyEvents = new EventEmitter()

/**
 * Regex matching the xterm modifyOtherKeys CSI format: \x1b[27;{modifier};{keycode}~
 * Groups: modifier (number), keycode (number)
 */
const MODIFY_OTHER_KEYS_RE = /\x1b\[27;(\d+);(\d+)~/g

/**
 * Also match Kitty keyboard protocol format: \x1b[{keycode};{modifier}u
 */
const KITTY_KEY_RE = /\x1b\[(\d+);(\d+)u/g

const ESC = "\x1b"

let activeProxy: (PassThrough & { setRawMode?: (mode: boolean) => void; isTTY?: boolean }) | null = null
let teardownProxyListeners: (() => void) | null = null

/**
 * Translate a modifyOtherKeys sequence back to its traditional encoding.
 *
 * Modifier values (from xterm):
 *   2 = Shift, 3 = Alt, 4 = Shift+Alt, 5 = Ctrl, 6 = Shift+Ctrl,
 *   7 = Alt+Ctrl, 8 = Shift+Alt+Ctrl
 *
 * @returns the translated bytes string, or null if this should be emitted as an event
 */
export function translateModifyOtherKeys(modifier: number, keycode: number): string | null {
	// xterm modifier encoding is (bits + 1), so:
	// modifier 2 = Shift (bit 0)
	// modifier 3 = Alt (bit 1)
	// modifier 5 = Ctrl (bit 2)
	// modifier 7 = Alt+Ctrl (bit 1 + bit 2)
	const bits = modifier - 1
	const hasAlt = (bits & 0x02) !== 0
	const hasCtrl = (bits & 0x04) !== 0

	// Alt+Backspace (DEL=127) or Ctrl+Backspace (DEL=127) → emit as word-delete event
	// Alt+Backspace: modifier=3 (hasAlt), Ctrl+Backspace: modifier=5 (hasCtrl)
	// Both should trigger word deletion. Ctrl+Backspace is sent by VSCode terminal
	// via Kitty protocol as \x1b[127;5u.
	if (keycode === 127 && (hasAlt || hasCtrl)) {
		return null // signal to emit event
	}

	// Ctrl+letter: translate back to control character
	// Ctrl+C (99) → \x03, Ctrl+D (100) → \x04, etc.
	if (hasCtrl && keycode >= 64 && keycode <= 127) {
		const ctrlChar = String.fromCharCode(keycode & 0x1f)
		if (hasAlt) {
			return "\x1b" + ctrlChar // Alt+Ctrl+key → ESC + control char
		}
		return ctrlChar
	}

	// Alt+letter: translate back to ESC + character (Meta prefix)
	if (hasAlt && !hasCtrl) {
		return "\x1b" + String.fromCharCode(keycode)
	}

	// For other combinations, pass through the original keycode
	return String.fromCharCode(keycode)
}

/**
 * Create an enhanced stdin proxy that intercepts modifier key sequences.
 *
 * Returns a PassThrough stream that proxies stdin but translates modifyOtherKeys
 * sequences back to traditional encodings. Alt+Backspace is emitted as an event
 * on enhancedKeyEvents instead of being passed to Ink.
 */
export function createEnhancedStdin(): PassThrough & { setRawMode?: (mode: boolean) => void; isTTY?: boolean } {
	if (activeProxy) {
		return activeProxy
	}

	const proxy = new PassThrough() as PassThrough & {
		setRawMode?: (mode: boolean) => void
		isTTY?: boolean
		fd?: number
	}

	// Proxy terminal properties and methods that Ink needs.
	// Ink's useInput hook calls stdin.ref()/unref() and setRawMode(),
	// which exist on process.stdin (a TTY Socket) but not on PassThrough.
	proxy.isTTY = process.stdin.isTTY
	;(proxy as any).fd = (process.stdin as any).fd
	if (typeof process.stdin.setRawMode === "function") {
		;(proxy as any).setRawMode = (mode: boolean) => {
			process.stdin.setRawMode(mode)
		}
	}
	;(proxy as any).ref = () => {
		if (typeof (process.stdin as any).ref === "function") {
			;(process.stdin as any).ref()
		}
	}
	;(proxy as any).unref = () => {
		if (typeof (process.stdin as any).unref === "function") {
			;(process.stdin as any).unref()
		}
	}

	const onData = (data: Buffer) => {
		const str = data.toString()

		// Ctrl+Backspace sends \x08 (BS) on macOS/Linux — distinct from regular
		// Backspace (\x7f). Intercept it as word-delete since Option+Backspace
		// is indistinguishable from Backspace in terminals without modifyOtherKeys.
		// This matches Gemini CLI and Codex CLI behavior.
		if (str === "\x08") {
			enhancedKeyEvents.emit("option-backspace")
			return
		}

		// Fast path: if no ESC character, pass through as-is
		if (!str.includes(ESC)) {
			proxy.write(data)
			return
		}

		// Check for modifyOtherKeys or Kitty sequences
		// Use a combined regex approach: find and replace all protocol sequences
		let result = ""
		let lastIndex = 0

		// Process modifyOtherKeys format: \x1b[27;{mod};{key}~
		const combined = str
		const matches: Array<{ index: number; length: number; modifier: number; keycode: number; format: string }> = []

		// Find all modifyOtherKeys matches
		MODIFY_OTHER_KEYS_RE.lastIndex = 0
		let match: RegExpExecArray | null
		while ((match = MODIFY_OTHER_KEYS_RE.exec(combined)) !== null) {
			matches.push({
				index: match.index,
				length: match[0].length,
				modifier: Number.parseInt(match[1], 10),
				keycode: Number.parseInt(match[2], 10),
				format: "modifyOtherKeys",
			})
		}

		// Find all Kitty protocol matches
		KITTY_KEY_RE.lastIndex = 0
		while ((match = KITTY_KEY_RE.exec(combined)) !== null) {
			matches.push({
				index: match.index,
				length: match[0].length,
				modifier: Number.parseInt(match[2], 10), // Note: Kitty format is [keycode;modifier]
				keycode: Number.parseInt(match[1], 10),
				format: "kitty",
			})
		}

		// If no protocol sequences found, pass through as-is
		if (matches.length === 0) {
			proxy.write(data)
			return
		}

		// Sort by index and process
		matches.sort((a, b) => a.index - b.index)

		for (const m of matches) {
			// Add any text before this match
			if (m.index > lastIndex) {
				result += combined.slice(lastIndex, m.index)
			}

			const translated = translateModifyOtherKeys(m.modifier, m.keycode)
			if (translated === null) {
				// Emit as event (e.g., Alt+Backspace)
				// Flush what we have so far
				if (result.length > 0) {
					proxy.write(Buffer.from(result))
					result = ""
				}
				enhancedKeyEvents.emit("option-backspace")
			} else {
				result += translated
			}

			lastIndex = m.index + m.length
		}

		// Add remaining text after last match
		if (lastIndex < combined.length) {
			result += combined.slice(lastIndex)
		}

		if (result.length > 0) {
			proxy.write(Buffer.from(result))
		}
	}

	const onEnd = () => proxy.end()
	const onError = (err: Error) => proxy.emit("error", err)

	process.stdin.on("data", onData)
	process.stdin.on("end", onEnd)
	process.stdin.on("error", onError)

	teardownProxyListeners = () => {
		process.stdin.off("data", onData)
		process.stdin.off("end", onEnd)
		process.stdin.off("error", onError)
	}
	activeProxy = proxy

	return proxy
}

export function destroyEnhancedStdin(): void {
	teardownProxyListeners?.()
	teardownProxyListeners = null
	activeProxy = null
}
