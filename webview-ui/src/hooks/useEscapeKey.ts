import { useEffect, useCallback } from "react"

/**
 * Custom hook for handling ESC key press events
 * @param isOpen - Whether the component is currently open/visible
 * @param onEscape - Callback function to execute when ESC is pressed
 * @param options - Additional options for the hook
 */
export function useEscapeKey(
	isOpen: boolean,
	onEscape: () => void,
	options: {
		preventDefault?: boolean
		stopPropagation?: boolean
	} = {},
) {
	const { preventDefault = true, stopPropagation = true } = options

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check isOpen inside the handler to ensure proper cleanup
			if (event.key === "Escape" && isOpen) {
				if (preventDefault) {
					event.preventDefault()
				}
				if (stopPropagation) {
					event.stopPropagation()
				}
				onEscape()
			}
		},
		[isOpen, onEscape, preventDefault, stopPropagation],
	)

	useEffect(() => {
		// Always add the event listener to ensure proper cleanup on unmount
		// The isOpen check is now inside the handler
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])
}
