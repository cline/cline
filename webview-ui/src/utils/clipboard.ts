import { useState, useCallback } from "react"

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

	const copyWithFeedback = useCallback(
		async (text: string, e?: React.MouseEvent) => {
			e?.stopPropagation()

			const success = await copyToClipboard(text, {
				onSuccess: () => {
					setShowCopyFeedback(true)
					setTimeout(() => setShowCopyFeedback(false), feedbackDuration)
				},
			})

			return success
		},
		[feedbackDuration],
	)

	return {
		showCopyFeedback,
		copyWithFeedback,
	}
}
