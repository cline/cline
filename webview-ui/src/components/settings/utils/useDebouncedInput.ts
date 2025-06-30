import { useState } from "react"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

/**
 * A custom hook that provides debounced input handling to prevent jumpy text inputs
 * when saving changes directly to backend on every keystroke.
 *
 * @param initialValue - The initial value for the input
 * @param onChange - Callback function to save the value (e.g., to backend)
 * @param debounceMs - Debounce delay in milliseconds (default: 500ms)
 * @returns A tuple of [currentValue, setValue] similar to useState
 */
export function useDebouncedInput<T>(
	initialValue: T,
	onChange: (value: T) => void,
	debounceMs: number = 100,
): [T, (value: T) => void] {
	// Local state to prevent jumpy input - initialize once
	const [localValue, setLocalValue] = useState(initialValue)

	// Debounced backend save - saves after user stops changing value
	useDebounceEffect(
		() => {
			onChange(localValue)
		},
		debounceMs,
		[localValue],
	)

	return [localValue, setLocalValue]
}
