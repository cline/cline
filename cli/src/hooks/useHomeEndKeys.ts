/**
 * Hook to detect Home/End keys and Option+Backspace from raw stdin.
 *
 * Ink's useInput hook parses Home/End keys but doesn't expose them in the key object,
 * and sets input to '' for these keys (because they're in nonAlphanumericKeys).
 *
 * For Option+Backspace, many terminals (like iTerm2 without "Esc+" configured) send
 * the same byte (\x7f) for both regular Backspace and Option+Backspace. To distinguish
 * them, the CLI enables xterm's modifyOtherKeys mode at startup (in index.ts), which
 * makes the terminal send \x1b[27;3;127~ for Alt+Backspace. A stdin proxy (enhanced-stdin)
 * intercepts this sequence before Ink sees it and emits an "option-backspace" event.
 *
 * This hook listens for:
 * - Raw stdin events (via internal_eventEmitter) for Home/End keys and \x1b\x7f
 * - Enhanced key events (via enhancedKeyEvents) for protocol-detected Option+Backspace
 */

import { useStdin } from "ink"
import { useCallback, useEffect, useRef } from "react"

import { END_SEQUENCES, HOME_SEQUENCES, OPTION_BACKSPACE_SEQUENCES } from "../constants/keyboard"
import { enhancedKeyEvents } from "../utils/enhanced-stdin"

interface UseHomeEndKeysOptions {
	onHome: () => void
	onEnd: () => void
	onOptionBackspace?: () => void
	isActive?: boolean
}

/**
 * Subscribe to raw stdin to detect Home/End keys and Option+Backspace.
 * These keys are parsed by Ink but not properly exposed in useInput's key object.
 */
export function useHomeEndKeys({ onHome, onEnd, onOptionBackspace, isActive = true }: UseHomeEndKeysOptions): void {
	// Use refs to avoid stale closure issues
	const onHomeRef = useRef(onHome)
	const onEndRef = useRef(onEnd)
	const onOptionBackspaceRef = useRef(onOptionBackspace)
	onHomeRef.current = onHome
	onEndRef.current = onEnd
	onOptionBackspaceRef.current = onOptionBackspace

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { internal_eventEmitter } = useStdin() as any

	// Handle raw stdin data for Home/End keys and traditional \x1b\x7f
	const handleInput = useCallback((data: Buffer | string) => {
		const s = typeof data === "string" ? data : data.toString()

		if (HOME_SEQUENCES.has(s)) {
			onHomeRef.current()
		} else if (END_SEQUENCES.has(s)) {
			onEndRef.current()
		} else if (OPTION_BACKSPACE_SEQUENCES.has(s)) {
			// Handles \x1b\x7f from terminals with "Esc+" configured
			onOptionBackspaceRef.current?.()
		}
	}, [])

	// Handle enhanced key events from stdin proxy (modifyOtherKeys protocol)
	const handleOptionBackspace = useCallback(() => {
		onOptionBackspaceRef.current?.()
	}, [])

	useEffect(() => {
		if (!isActive) {
			return
		}

		// Listen for protocol-detected Option+Backspace from stdin proxy
		enhancedKeyEvents.on("option-backspace", handleOptionBackspace)

		// Listen for raw stdin events (Home/End keys, traditional \x1b\x7f)
		if (internal_eventEmitter) {
			internal_eventEmitter.on("input", handleInput)
		}

		return () => {
			enhancedKeyEvents.removeListener("option-backspace", handleOptionBackspace)
			if (internal_eventEmitter) {
				internal_eventEmitter.removeListener("input", handleInput)
			}
		}
	}, [isActive, internal_eventEmitter, handleInput, handleOptionBackspace])
}
