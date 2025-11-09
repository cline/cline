import { cn } from "@/lib/utils"

interface RecordingIndicatorProps {
	duration: number
	className?: string
}

/**
 * Visual indicator shown while recording audio
 * Displays a pulsing red dot and the recording duration
 */
export function RecordingIndicator({ duration, className }: RecordingIndicatorProps) {
	const formatDuration = (seconds: number) => {
		const mins = Math.floor(seconds / 60)
		const secs = Math.floor(seconds % 60)
		return `${mins}:${secs.toString().padStart(2, "0")}`
	}

	return (
		<div className={cn("flex items-center gap-2 text-sm text-red-500", className)} data-testid="recording-indicator">
			<span className="relative flex h-2 w-2">
				<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
				<span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
			</span>
			<span>Recording {formatDuration(duration)}</span>
		</div>
	)
}
