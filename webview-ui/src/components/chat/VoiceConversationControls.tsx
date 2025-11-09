import { PauseIcon, PlayIcon, SkipForwardIcon, Volume2Icon, VolumeXIcon } from "lucide-react"
import React, { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { AudioPlayerHandle } from "./AudioPlayer"

export interface VoiceConversationControlsProps {
	/** Reference to the audio player */
	audioPlayerRef: React.RefObject<AudioPlayerHandle>
	/** Whether audio is currently playing */
	isPlaying: boolean
	/** Whether audio is currently paused */
	isPaused?: boolean
	/** Current queue size */
	queueSize: number
	/** Whether controls should be disabled */
	disabled?: boolean
	/** Optional CSS class name */
	className?: string
}

/**
 * Voice conversation controls for managing TTS playback.
 * Provides play/pause, skip, and stop functionality.
 */
const VoiceConversationControls: React.FC<VoiceConversationControlsProps> = ({
	audioPlayerRef,
	isPlaying,
	isPaused = false,
	queueSize,
	disabled = false,
	className,
}) => {
	const handlePlayPause = useCallback(() => {
		if (!audioPlayerRef.current) return

		if (isPaused) {
			audioPlayerRef.current.resume()
		} else if (isPlaying) {
			audioPlayerRef.current.pause()
		}
	}, [audioPlayerRef, isPlaying, isPaused])

	const handleSkip = useCallback(() => {
		if (!audioPlayerRef.current) return

		// Stop current playback and let the queue continue
		const queue = audioPlayerRef.current.getQueue()
		if (queue.length > 0) {
			// Remove current item to skip to next
			audioPlayerRef.current.stop()
			// Re-add remaining items
			queue.slice(1).forEach((item) => {
				audioPlayerRef.current?.enqueue(item)
			})
		}
	}, [audioPlayerRef])

	const handleStop = useCallback(() => {
		if (!audioPlayerRef.current) return
		audioPlayerRef.current.stop()
	}, [audioPlayerRef])

	// Don't show controls if not playing and no queue
	if (!isPlaying && queueSize === 0) {
		return null
	}

	return (
		<div className={cn("flex items-center gap-1", className)}>
			{/* Play/Pause Button */}
			{isPlaying && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							className="h-8 w-8 p-0"
							data-testid="voice-play-pause-button"
							disabled={disabled}
							onClick={handlePlayPause}
							size="sm"
							variant="ghost">
							{isPaused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{isPaused ? "Resume" : "Pause"}</TooltipContent>
				</Tooltip>
			)}

			{/* Skip Button */}
			{queueSize > 1 && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							className="h-8 w-8 p-0"
							data-testid="voice-skip-button"
							disabled={disabled}
							onClick={handleSkip}
							size="sm"
							variant="ghost">
							<SkipForwardIcon className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Skip to Next</TooltipContent>
				</Tooltip>
			)}

			{/* Stop Button */}
			{(isPlaying || queueSize > 0) && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							className="h-8 w-8 p-0 text-destructive hover:text-destructive"
							data-testid="voice-stop-button"
							disabled={disabled}
							onClick={handleStop}
							size="sm"
							variant="ghost">
							<VolumeXIcon className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Stop All Audio</TooltipContent>
				</Tooltip>
			)}

			{/* Queue indicator */}
			{queueSize > 1 && (
				<div className="flex items-center gap-1 ml-1 text-xs text-muted-foreground">
					<Volume2Icon className="h-3 w-3" />
					<span>+{queueSize - 1}</span>
				</div>
			)}
		</div>
	)
}

export default VoiceConversationControls
