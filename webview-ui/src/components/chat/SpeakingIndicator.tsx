import { Volume2Icon } from "lucide-react"
import React from "react"
import { cn } from "@/lib/utils"

export interface SpeakingIndicatorProps {
	/** Whether audio is currently playing */
	isPlaying: boolean
	/** Optional CSS class name */
	className?: string
	/** Size variant */
	size?: "sm" | "md" | "lg"
	/** Show text label */
	showLabel?: boolean
}

/**
 * Visual indicator that shows when Cline is speaking (TTS audio is playing).
 * Displays an animated speaker icon.
 */
const SpeakingIndicator: React.FC<SpeakingIndicatorProps> = ({ isPlaying, className, size = "md", showLabel = false }) => {
	if (!isPlaying) {
		return null
	}

	const sizeClasses = {
		sm: "w-4 h-4",
		md: "w-5 h-5",
		lg: "w-6 h-6",
	}

	const textSizeClasses = {
		sm: "text-xs",
		md: "text-sm",
		lg: "text-base",
	}

	return (
		<div className={cn("flex items-center gap-2 text-muted-foreground", className)}>
			<Volume2Icon
				className={cn("animate-pulse", sizeClasses[size])}
				style={{
					animation: "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",
				}}
			/>
			{showLabel && <span className={cn("font-medium", textSizeClasses[size])}>Speaking...</span>}
		</div>
	)
}

export default SpeakingIndicator
