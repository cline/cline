import { useState, useCallback, useRef } from "react"

interface UseTooltipOptions {
	delay?: number
}

export const useTooltip = (options: UseTooltipOptions = {}) => {
	const { delay = 300 } = options
	const [showTooltip, setShowTooltip] = useState(false)
	const timeoutRef = useRef<NodeJS.Timeout | null>(null)

	const handleMouseEnter = useCallback(() => {
		if (timeoutRef.current) clearTimeout(timeoutRef.current)
		timeoutRef.current = setTimeout(() => setShowTooltip(true), delay)
	}, [delay])

	const handleMouseLeave = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}
		setShowTooltip(false)
	}, [])

	// Cleanup on unmount
	const cleanup = useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
			timeoutRef.current = null
		}
	}, [])

	return {
		showTooltip,
		handleMouseEnter,
		handleMouseLeave,
		cleanup,
	}
}
