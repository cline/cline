import React, { useMemo } from "react"
import { cn } from "@/utils/cn"

export const AutoCondenseMarker: React.FC<{ threshold: number; usage: number }> = ({ threshold, usage }) => {
	if (!threshold || !usage) {
		return null
	}

	// The marker position is calculated based on the threshold percentage
	// It goes over the progress bar to indicate where the auto-condense will trigger
	// and it should highlight from what the current percentage (usage) is
	// to the threshold percentage
	const marker = useMemo(() => {
		const _threshold = threshold * 100
		return {
			start: `${_threshold}%`,
			rounded: _threshold.toFixed(0),
			length: `${100 - _threshold}%`,
		}
	}, [threshold, usage])

	return (
		<div
			className={cn(
				"absolute top-0 bottom-0 h-full cursor-pointer pointer-events-none z-10 rounded-r bg-badge-background/30",
			)}
			style={{ left: marker.start, width: marker.length }}
			title={`Auto compact threshold at ${marker.rounded}% ${usage}`}
		/>
	)
}
AutoCondenseMarker.displayName = "AutoCondenseMarker"
