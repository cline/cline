import { RefObject, useEffect } from "react"

/**
 * Hook that handles clicks outside of the specified element
 * @param ref React ref object pointing to the element to monitor
 * @param callback Function to call when a click outside occurs
 * @param isActive Optional boolean to conditionally enable/disable the hook
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
	ref: RefObject<T>,
	callback: () => void,
	isActive: boolean = true,
): void {
	useEffect(() => {
		if (!isActive) return

		const handleClickOutside = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				callback()
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [ref, callback, isActive])
}

export default useClickOutside
