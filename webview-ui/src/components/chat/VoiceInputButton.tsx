import { MicIcon, MicOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface VoiceInputButtonProps {
	isRecording: boolean
	isTranscribing: boolean
	disabled: boolean
	onClick: () => void
}

/**
 * Button component for voice input in Discuss Mode
 * Shows different states for recording, transcribing, and idle
 */
export function VoiceInputButton({ isRecording, isTranscribing, disabled, onClick }: VoiceInputButtonProps) {
	const getTooltipText = () => {
		if (isTranscribing) return "Transcribing audio..."
		if (isRecording) return "Click to stop recording"
		return "Click to start voice input"
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					className={isRecording ? "text-red-500 animate-pulse" : ""}
					data-testid="voice-input-button"
					disabled={disabled || isTranscribing}
					onClick={onClick}
					size="sm"
					variant="ghost">
					{isRecording ? <MicOffIcon className="h-4 w-4" /> : <MicIcon className="h-4 w-4" />}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{getTooltipText()}</TooltipContent>
		</Tooltip>
	)
}
