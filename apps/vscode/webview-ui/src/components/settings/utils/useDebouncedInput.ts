import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A custom hook that provides debounced input handling to prevent jumpy text inputs
 * when saving changes directly to backend on every keystroke.
 *
 * `onChange` is only called for values passed to the returned setter. Syncing a
 * new `initialValue` from props updates local UI state without saving it back.
 *
 * @param initialValue - The initial value for the input
 * @param onChange - Callback function to save the value (e.g., to backend)
 * @param debounceMs - Debounce delay in milliseconds
 * @returns A tuple of [currentValue, setValue] similar to useState
 */
interface UseDebouncedInputOptions {
	shouldSyncInitialValue?: () => boolean
}

export function useDebouncedInput<T>(
	initialValue: T,
	onChange: (value: T) => void,
	debounceMs: number = 100,
	options: UseDebouncedInputOptions = {},
): [T, (value: T) => void] {
	const [localValue, setLocalValue] = useState(initialValue)
	const timeoutRef = useRef<NodeJS.Timeout | null>(null)
	const onChangeRef = useRef(onChange)
	const shouldSyncInitialValueRef = useRef(options.shouldSyncInitialValue)

	useEffect(() => {
		onChangeRef.current = onChange
		shouldSyncInitialValueRef.current = options.shouldSyncInitialValue
	}, [onChange, options.shouldSyncInitialValue])

	useEffect(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}

		if (shouldSyncInitialValueRef.current?.() === false) {
			return
		}

		setLocalValue(initialValue)
	}, [initialValue])

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	const setAndDebounceSave = useCallback(
		(value: T) => {
			setLocalValue(value)

			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}

			timeoutRef.current = setTimeout(() => {
				onChangeRef.current(value)
				timeoutRef.current = null
			}, debounceMs)
		},
		[debounceMs],
	)

	return [localValue, setAndDebounceSave]
}
