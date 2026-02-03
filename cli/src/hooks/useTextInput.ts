/**
 * Text input hook with cursor management and keyboard shortcut handling.
 *
 * Supports essential terminal shortcuts:
 * - Option+Left/Right: move by word (via escape sequences)
 * - Ctrl+A/E: start/end of line
 * - Ctrl+W: delete word backwards
 * - Ctrl+U: delete to start of line
 *
 * Note: Home/End keys are handled by useHomeEndKeys hook because Ink doesn't
 * expose them in useInput (it sets input='' for these keys).
 */

import { useCallback, useRef, useState } from "react"

import { OPTION_LEFT_SEQUENCES, OPTION_RIGHT_SEQUENCES } from "../constants/keyboard"

/**
 * Keyboard escape sequence types for special key combinations.
 * Only includes sequences that Ink passes through in the input string.
 */
type KeyboardSequence =
	| "option-left" // Move word left
	| "option-right" // Move word right
	| null

/**
 * Parse keyboard escape sequences for special key combinations.
 * Only handles Option+arrow - Home/End are handled by useHomeEndKeys.
 */
function parseKeyboardSequence(input: string): KeyboardSequence {
	if (OPTION_LEFT_SEQUENCES.has(input)) {
		return "option-left"
	}
	if (OPTION_RIGHT_SEQUENCES.has(input)) {
		return "option-right"
	}
	return null
}

/**
 * Find the start of the previous word from cursor position.
 */
export function findWordStart(text: string, cursorPos: number): number {
	let pos = cursorPos
	// Skip whitespace before cursor
	while (pos > 0 && /\s/.test(text[pos - 1])) {
		pos--
	}
	// Skip word characters
	while (pos > 0 && !/\s/.test(text[pos - 1])) {
		pos--
	}
	return pos
}

/**
 * Find the end of the next word from cursor position.
 */
export function findWordEnd(text: string, cursorPos: number): number {
	let pos = cursorPos
	// Skip word characters
	while (pos < text.length && !/\s/.test(text[pos])) {
		pos++
	}
	// Skip whitespace
	while (pos < text.length && /\s/.test(text[pos])) {
		pos++
	}
	return pos
}

export interface UseTextInputReturn {
	// State
	text: string
	cursorPos: number

	// Text manipulation
	setText: (text: string) => void
	insertText: (text: string) => void
	setCursorPos: (pos: number | ((prev: number) => number)) => void

	// Deletion
	deleteCharBefore: () => void

	// Keyboard shortcut handlers
	handleKeyboardSequence: (input: string) => boolean
	handleCtrlShortcut: (key: string) => boolean
}

/**
 * Hook for managing text input with cursor and keyboard shortcuts.
 */
export function useTextInput(): UseTextInputReturn {
	const [text, setTextState] = useState("")
	const [cursorPos, setCursorPosState] = useState(0)

	// Use refs to get current values in callbacks without stale closures
	const textRef = useRef(text)
	const cursorRef = useRef(cursorPos)
	textRef.current = text
	cursorRef.current = cursorPos

	// Text manipulation
	const setText = useCallback((newText: string) => {
		setTextState(newText)
		setCursorPosState(newText.length)
	}, [])

	const insertText = useCallback((insertedText: string) => {
		const pos = cursorRef.current
		setTextState((prev) => prev.slice(0, pos) + insertedText + prev.slice(pos))
		setCursorPosState(pos + insertedText.length)
	}, [])

	const setCursorPos = useCallback((pos: number | ((prev: number) => number)) => {
		setCursorPosState((prev) => {
			const newPos = typeof pos === "function" ? pos(prev) : pos
			return Math.max(0, Math.min(textRef.current.length, newPos))
		})
	}, [])

	// Deletion
	const deleteCharBefore = useCallback(() => {
		const pos = cursorRef.current
		if (pos > 0) {
			setTextState((prev) => prev.slice(0, pos - 1) + prev.slice(pos))
			setCursorPosState(pos - 1)
		}
	}, [])

	const deleteWordBefore = useCallback(() => {
		const pos = cursorRef.current
		const wordStart = findWordStart(textRef.current, pos)
		if (wordStart < pos) {
			setTextState((prev) => prev.slice(0, wordStart) + prev.slice(pos))
			setCursorPosState(wordStart)
		}
	}, [])

	const deleteToStart = useCallback(() => {
		const pos = cursorRef.current
		if (pos > 0) {
			setTextState((prev) => prev.slice(pos))
			setCursorPosState(0)
		}
	}, [])

	// Cursor movement (internal, used by handlers)
	const moveToStart = useCallback(() => setCursorPosState(0), [])
	const moveToEnd = useCallback(() => setCursorPosState(textRef.current.length), [])
	const moveWordLeft = useCallback(() => setCursorPosState((pos) => findWordStart(textRef.current, pos)), [])
	const moveWordRight = useCallback(() => setCursorPosState((pos) => findWordEnd(textRef.current, pos)), [])

	// Keyboard shortcut handlers
	const handleKeyboardSequence = useCallback(
		(input: string): boolean => {
			const seq = parseKeyboardSequence(input)
			if (!seq) return false

			switch (seq) {
				case "option-left":
					moveWordLeft()
					return true
				case "option-right":
					moveWordRight()
					return true
				default:
					return false
			}
		},
		[moveWordLeft, moveWordRight],
	)

	const handleCtrlShortcut = useCallback(
		(key: string): boolean => {
			switch (key.toLowerCase()) {
				case "a": // Ctrl+A - start of line
					moveToStart()
					return true
				case "e": // Ctrl+E - end of line
					moveToEnd()
					return true
				case "u": // Ctrl+U - delete to start
					deleteToStart()
					return true
				case "w": // Ctrl+W - delete word backwards
					deleteWordBefore()
					return true
				default:
					return false
			}
		},
		[moveToStart, moveToEnd, deleteToStart, deleteWordBefore],
	)

	return {
		text,
		cursorPos,
		setText,
		insertText,
		setCursorPos,
		deleteCharBefore,
		handleKeyboardSequence,
		handleCtrlShortcut,
	}
}
