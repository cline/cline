import { TranscribeAudioRequest } from "@shared/proto/cline/dictation"
import { EmptyRequest } from "@shared/proto/index.cline"
import { SquareIcon, StopCircleIcon } from "lucide-react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { DictationServiceClient } from "@/services/grpc-client"
import { formatSeconds } from "@/utils/format"

interface VoiceRecorderProps {
	onTranscription: (text: string) => void
	onProcessingStateChange?: (isProcessing: boolean, message?: string) => void
	onRecordingStateChange?: (isRecording: boolean) => void
	disabled?: boolean
	language?: string
	isAuthenticated?: boolean
}

const MAX_DURATION = 5 * 60 // 5 minutes in seconds

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
	onTranscription,
	onProcessingStateChange,
	onRecordingStateChange,
	disabled = false,
	language = "en",
	isAuthenticated = false,
}) => {
	const [isRecording, setIsRecording] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [isStarting, setIsStarting] = useState(false) // New state for loading
	const [recordingDuration, setRecordingDuration] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

	// Notify parent when recording state changes
	useEffect(() => {
		onRecordingStateChange?.(isRecording)
	}, [isRecording, onRecordingStateChange])

	// Auto-clear authentication errors when user signs in
	useEffect(() => {
		if (isAuthenticated && error) {
			// Clear error if it's related to authentication
			if (error.toLowerCase().includes("sign in") || error.toLowerCase().includes("cline account")) {
				setError(null)
			}
		}
	}, [isAuthenticated, error])

	const startRecording = useCallback(async () => {
		try {
			// Show loading state instead of immediately setting recording
			setIsStarting(true)
			setError(null) // Clear any previous errors
			onProcessingStateChange?.(false) // Clear any previous processing state
			setRecordingDuration(0) // Reset recording duration

			// Call Extension Host to start recording
			const response = await DictationServiceClient.startRecording(EmptyRequest.create({}))

			if (!response.success) {
				console.error("Failed to start recording:", response.error)
				setError(response.error || "Failed to start recording")
				return
			}

			// Only set recording state after backend confirms success
			setIsRecording(true)
			console.log("Recording started successfully")
		} catch (error) {
			console.error("Error starting recording:", error)
			const errorMessage = error instanceof Error ? error.message : "Failed to start recording"
			setError(errorMessage)
		} finally {
			// Always clear the starting state
			setIsStarting(false)
		}
	}, [onProcessingStateChange])

	const stopRecording = useCallback(async () => {
		try {
			setIsRecording(false)
			setIsProcessing(true)
			onProcessingStateChange?.(true, "Processing...")

			// Call Extension Host to stop recording and get audio
			const response = await DictationServiceClient.stopRecording(EmptyRequest.create({}))

			if (!response.success) {
				console.error("Failed to stop recording:", response.error)
				setIsProcessing(false)
				const errorMessage = response.error || "Failed to stop recording"
				setError(errorMessage)
				onTranscription("")
				return
			}

			if (!response.audioBase64) {
				setIsProcessing(false)
				const errorMessage = "No audio data received"
				setError(errorMessage)
				onTranscription("")
				return
			}

			// Update processing state for transcription
			onProcessingStateChange?.(true, "Transcribing...")

			// Transcribe the audio using OpenAI Whisper
			const transcriptionResponse = await DictationServiceClient.transcribeAudio(
				TranscribeAudioRequest.create({
					audioBase64: response.audioBase64,
					language: language,
				}),
			)

			if (transcriptionResponse.error) {
				setError(transcriptionResponse.error)
				onTranscription("")
				// Clear the error after a delay
				setTimeout(() => {
					setError(null)
					onProcessingStateChange?.(false)
				}, 5000)
			} else if (transcriptionResponse.text) {
				setError(null)
				onTranscription(transcriptionResponse.text)
				onProcessingStateChange?.(false)
			}
		} catch (error) {
			console.error("Error stopping recording:", error)
			const errorMessage = error instanceof Error ? error.message : "An error occurred"
			setError(errorMessage)
			onTranscription("")
		} finally {
			setIsProcessing(false)
		}
	}, [onTranscription, onProcessingStateChange])

	// Poll recording status while recording to update duration
	useEffect(() => {
		const pollRecordingStatus = async () => {
			try {
				const statusResponse = await DictationServiceClient.getRecordingStatus(EmptyRequest.create({}))
				if (statusResponse.isRecording) {
					setRecordingDuration(Math.floor(statusResponse.durationSeconds))

					// Auto-stop if max duration reached
					if (statusResponse.durationSeconds >= MAX_DURATION) {
						stopRecording()
					}
				}
			} catch (error) {
				console.error("Error polling recording status:", error)
			}
		}

		if (isRecording && !isProcessing) {
			pollingIntervalRef.current = setInterval(pollRecordingStatus, 1000)
		} else {
			// Clear polling when not recording
			if (pollingIntervalRef.current) {
				clearInterval(pollingIntervalRef.current)
				pollingIntervalRef.current = null
			}
		}

		// Cleanup on unmount
		return () => {
			if (pollingIntervalRef.current) {
				clearInterval(pollingIntervalRef.current)
				pollingIntervalRef.current = null
			}
		}
	}, [isRecording, isProcessing, stopRecording])

	const cancelRecording = useCallback(async () => {
		try {
			setIsRecording(false)
			setError(null)
			onProcessingStateChange?.(false)
			onTranscription("")

			// Call Extension Host to cancel recording
			const response = await DictationServiceClient.cancelRecording(EmptyRequest.create({}))

			if (!response.success) {
				console.error("Failed to cancel recording:", response.error)
				setError(response.error || "Failed to cancel recording")
				return
			}

			console.log("Recording canceled successfully")
		} catch (error) {
			console.error("Error canceling recording:", error)
			const errorMessage = error instanceof Error ? error.message : "Failed to cancel recording"
			setError(errorMessage)
		}
	}, [onProcessingStateChange, onTranscription])

	const handleStartClick = useCallback(() => {
		if (disabled || isProcessing || isStarting) {
			return
		}
		if (error) {
			return setError(null)
		}
		startRecording()
	}, [startRecording, disabled, isProcessing, isStarting, error])

	const handleCancelClick = useCallback(() => {
		if (disabled || isProcessing) {
			return
		}
		cancelRecording()
	}, [cancelRecording, disabled, isProcessing])

	const handleStopClick = useCallback(() => {
		if (disabled || isProcessing) {
			return
		}
		stopRecording()
	}, [stopRecording, disabled, isProcessing])

	const iconAdjustment = isProcessing || isStarting ? "mt-0" : error ? "mt-1" : "mt-0.5"
	// When not recording, show single mic button
	if (!isRecording) {
		const iconClass = isProcessing
			? "codicon-loading"
			: isStarting
				? "codicon-loading"
				: error
					? "codicon-error"
					: "codicon-mic"
		const iconColor = error ? "text-error" : ""
		const tooltipContent = isProcessing
			? "Transcribing..."
			: isStarting
				? "Starting recording..."
				: error
					? `Error: ${error}`
					: "Voice Input"

		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div
						className={cn("pt-1 input-icon-button mr-1.5 text-base", iconAdjustment, {
							disabled: disabled || isProcessing || isStarting,
							"animate-spin": isProcessing || isStarting,
						})}
						data-testid="voice-recorder-start-button"
						onClick={handleStartClick}
						style={{ color: iconColor }}>
						<span className={`codicon ${iconClass}`} />
					</div>
				</TooltipTrigger>
				<TooltipContent side="top">{tooltipContent}</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<div className={cn("flex items-center mb-2", { "mr-0.5": isRecording, "mr-1.5": !isRecording })}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						className={cn("input-icon-button p-1 m-0 mr-1.5 text-base", iconAdjustment, {
							disabled: disabled || isProcessing,
							"animate-spin": isProcessing || isStarting,
						})}
						data-testid="stop-recording-button"
						onClick={handleStopClick}
						size="sm"
						variant="icon">
						<StopCircleIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">
					Stop Recording ({formatSeconds(recordingDuration)}/{formatSeconds(MAX_DURATION)})
				</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						className={cn("input-icon-button p-1 m-0 text-base text-error", iconAdjustment, {
							"animate-spin": isProcessing || isStarting,
							disabled: disabled || isProcessing,
						})}
						data-testid="cancel-recording-button"
						onClick={handleCancelClick}
						size="sm"
						variant="icon">
						<SquareIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top">Cancel Recording</TooltipContent>
			</Tooltip>
		</div>
	)
}

export default VoiceRecorder
