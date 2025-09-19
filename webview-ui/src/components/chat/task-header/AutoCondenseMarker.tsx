import React, { useMemo } from "react"

export const AutoCondenseMarker: React.FC<{ threshold: number; usage: number; isContextWindowHoverOpen?: boolean }> = ({
	threshold,
	usage,
	isContextWindowHoverOpen,
}) => {
	// The marker position is calculated based on the threshold percentage
	// It goes over the progress bar to indicate where the auto-condense will trigger
	// and it should highlight from what the current percentage (usage) is
	// to the threshold percentage
	const marker = useMemo(() => {
		const _threshold = threshold * 100
		return {
			start: _threshold + "%",
			label: _threshold.toFixed(0),
			end: usage >= threshold * 100 ? usage - _threshold + "%" : undefined,
		}
	}, [threshold, usage, isContextWindowHoverOpen])

	if (!threshold) {
		return null
	}

	return (
		<div className="flex-1" id="auto-condense-threshold-marker">
			<div
				className="absolute top-0 bottom-0 h-full cursor-pointer pointer-events-none z-10 bg-button-background shadow-lg outline-button-background/80 outline-0.5 w-1.5"
				style={{ left: marker.start }}>
				{isContextWindowHoverOpen && (
					<div className="absolute -top-4 -left-1 text-button-background/80">{marker.label}%</div>
				)}
				{marker.end !== undefined && (
					<div
						className="fixed top-0 bottom-0 h-full z-20 bg-black/45"
						style={{ left: marker.start, width: marker.end }}></div>
				)}
			</div>
		</div>
	)
}
AutoCondenseMarker.displayName = "AutoCondenseMarker"
