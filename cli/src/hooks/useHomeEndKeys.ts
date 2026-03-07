/**
 * Hook to detect Home/End keys from raw stdin.
 *
 * Ink's useInput hook parses Home/End keys but doesn't expose them in the key object,
 * and sets input to '' for these keys (because they're in nonAlphanumericKeys).
 * This hook subscribes to raw stdin events to detect Home/End before Ink processes them.
 */

import { useStdin } from "ink"
import { useCallback, useEffect, useRef } from "react"

import { END_SEQUENCES, HOME_SEQUENCES } from "../constants/keyboard"

interface UseHomeEndKeysOptions {
	onHome: () => void
	onEnd: () => void
	isActive?: boolean
}

/**
 * Subscribe to raw stdin to detect Home/End keys.
 * These keys are parsed by Ink but not exposed in useInput's key object.
 */
export function useHomeEndKeys({ onHome, onEnd, isActive = true }: UseHomeEndKeysOptions): void {
	// Use refs to avoid stale closure issues
	const onHomeRef = useRef(onHome)
	const onEndRef = useRef(onEnd)
	onHomeRef.current = onHome
	onEndRef.current = onEnd

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { internal_eventEmitter } = useStdin() as any

	const handleInput = useCallback((data: Buffer | string) => {
		const s = typeof data === "string" ? data : data.toString()

		if (HOME_SEQUENCES.has(s)) {
			onHomeRef.current()
		} else if (END_SEQUENCES.has(s)) {
			onEndRef.current()
		}
	}, [])

	useEffect(() => {
		if (!isActive || !internal_eventEmitter) {
			return
		}

		internal_eventEmitter.on("input", handleInput)
		return () => {
			internal_eventEmitter.removeListener("input", handleInput)
		}
	}, [isActive, internal_eventEmitter, handleInput])
}
