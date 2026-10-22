import { useCallback, useEffect, useRef, useState } from "react"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

/**
 * A custom hook that provides debounced input handling to prevent jumpy text inputs
 * when saving changes directly to backend on every keystroke.
 *
 * `onChange` only fires for values set through the returned setter (user
 * edits). It must not fire on mount or when `initialValue` resyncs
 * externally: fields often mount with a placeholder (e.g. an empty API key
 * mask) while their backing config is still loading asynchronously, and
 * echoing that placeholder back to the backend would overwrite — or, for
 * secret fields, silently delete — the stored value.
 *
 * @param initialValue - The initial value for the input
 * @param onChange - Callback function to save the value (e.g., to backend)
 * @param debounceMs - Debounce delay in milliseconds (default: 500ms)
 * @returns The current value, an editing setter, and an authoritative sync setter
 */
export function useDebouncedInput<T>(
	initialValue: T,
	onChange: (value: T) => void,
	debounceMs: number = 100,
): [T, (value: T) => void, (value: T) => void] {
	// Local state to prevent jumpy input - initialize once
	const [localValue, setLocalValueState] = useState(initialValue)

	// Track previous initialValue to detect external changes
	const prevInitialValueRef = useRef<T>(initialValue)

	// Whether the current localValue came from the returned setter (a user
	// edit) rather than from mount or an external initialValue resync.
	const hasPendingUserEditRef = useRef(false)

	const setLocalValue = useCallback((value: T) => {
		hasPendingUserEditRef.current = true
		setLocalValueState(value)
	}, [])
	const syncLocalValue = useCallback((value: T) => {
		hasPendingUserEditRef.current = false
		setLocalValueState(value)
	}, [])

	// Sync local state when initialValue changes externally (e.g., when switching
	// Plan/Act tabs). Skip the resync while a user edit is pending: because each
	// debounced save round-trips through the backend and updates initialValue,
	// an in-flight save can echo back an older value while the user is still
	// typing, and resyncing would visibly delete their newest keystrokes.
	useEffect(() => {
		if (prevInitialValueRef.current !== initialValue) {
			prevInitialValueRef.current = initialValue
			if (!hasPendingUserEditRef.current) {
				setLocalValueState(initialValue)
			}
		}
	}, [initialValue])

	// Debounced backend save - saves after user stops changing value
	useDebounceEffect(
		() => {
			if (!hasPendingUserEditRef.current) {
				return
			}
			hasPendingUserEditRef.current = false
			onChange(localValue)
		},
		debounceMs,
		[localValue],
	)

	// Flush a pending edit on unmount so keystrokes typed within the debounce
	// window still save when the view closes (e.g. clicking Done in settings).
	const latestRef = useRef({ localValue, onChange })
	latestRef.current = { localValue, onChange }
	useEffect(
		() => () => {
			if (hasPendingUserEditRef.current) {
				hasPendingUserEditRef.current = false
				latestRef.current.onChange(latestRef.current.localValue)
			}
		},
		[],
	)

	return [localValue, setLocalValue, syncLocalValue]
}
