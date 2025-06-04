import { useState, useCallback, useEffect, useRef } from "react"

/**
 * Options for copying text to clipboard
 */
interface CopyOptions {
	/** Duration in ms to show success feedback (default: 2000) */
	feedbackDuration?: number
	/** Optional callback when copy succeeds */
	onSuccess?: () => void
	/** Optional callback when copy fails */
	onError?: (error: Error) => void
}

/**
 * Copy text to clipboard with error handling
 */
export const copyToClipboard = async (text: string, options?: CopyOptions): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(text)
		options?.onSuccess?.()
		return true
	} catch (error) {
		const err = error instanceof Error ? error : new Error("Failed to copy to clipboard")
		options?.onError?.(err)
		console.error("Failed to copy to clipboard:", err)
		return false
	}
}

/**
 * React hook for managing clipboard copy state with feedback
 */
export const useCopyToClipboard = (feedbackDuration = 2000) => {
	const [showCopyFeedback, setShowCopyFeedback] = useState(false)
	const timeoutRef = useRef<NodeJS.Timeout | null>(null)

	const copyWithFeedback = useCallback(
		async (text: string, e?: React.MouseEvent) => {
			e?.stopPropagation()

			// Clear any existing timeout
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}

			const success = await copyToClipboard(text, {
				onSuccess: () => {
					setShowCopyFeedback(true)
					timeoutRef.current = setTimeout(() => {
						setShowCopyFeedback(false)
						timeoutRef.current = null
					}, feedbackDuration)
				},
			})

			return success
		},
		[feedbackDuration],
	)

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [])

	return {
		showCopyFeedback,
		copyWithFeedback,
	}
}
