import React, { useState, useCallback, useEffect, useRef } from "react"
import { VoiceServiceClient } from "@/services/grpc-client"
import {
	StartRecordingRequest,
	StopRecordingRequest,
	TranscribeAudioRequest,
	GetRecordingStatusRequest,
} from "@shared/proto/cline/voice"

import HeroTooltip from "../common/HeroTooltip"
import { formatSeconds } from "@/utils/format"

interface VoiceRecorderProps {
	onTranscription: (text: string) => void
	onProcessingStateChange?: (isProcessing: boolean, message?: string) => void
	disabled?: boolean
	language?: string
}

const MAX_DURATION = 5 * 60 // 5 minutes in seconds

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
	onTranscription,
	onProcessingStateChange,
	disabled = false,
	language = "en",
}) => {
	const [isRecording, setIsRecording] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [recordingDuration, setRecordingDuration] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

	const startRecording = useCallback(async () => {
		try {
			setIsRecording(true)
			setError(null) // Clear any previous errors
			onProcessingStateChange?.(false) // Clear any previous processing state
			setRecordingDuration(0) // Reset recording duration

			// Call Extension Host to start recording
			const response = await VoiceServiceClient.startRecording(StartRecordingRequest.create({}))

			if (!response.success) {
				console.error("Failed to start recording:", response.error)
				setIsRecording(false)
				setError(response.error || "Failed to start recording")
				return
			}

			console.log("Recording started successfully")
		} catch (error) {
			console.error("Error starting recording:", error)
			setIsRecording(false)
			const errorMessage = error instanceof Error ? error.message : "Failed to start recording"
			setError(errorMessage)
		}
	}, [onProcessingStateChange])

	const stopRecording = useCallback(async () => {
		try {
			setIsRecording(false)
			setIsProcessing(true)
			onProcessingStateChange?.(true, "Processing...")

			// Call Extension Host to stop recording and get audio
			const response = await VoiceServiceClient.stopRecording(StopRecordingRequest.create({}))

			if (!response.success) {
				console.error("Failed to stop recording:", response.error)
				setIsProcessing(false)
				const errorMessage = response.error || "Failed to stop recording"
				setError(errorMessage)
				return
			}

			if (!response.audioBase64) {
				console.error("No audio data received")
				setIsProcessing(false)
				const errorMessage = "No audio data received"
				setError(errorMessage)
				return
			}

			// Update processing state for transcription
			onProcessingStateChange?.(true, "Transcribing...")

			// Transcribe the audio using OpenAI Whisper
			const transcriptionResponse = await VoiceServiceClient.transcribeAudio(
				TranscribeAudioRequest.create({
					audioBase64: response.audioBase64,
					language: language,
				}),
			)

			if (transcriptionResponse.error) {
				console.error("Transcription error:", transcriptionResponse.error)
				setError(transcriptionResponse.error)
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
		} finally {
			setIsProcessing(false)
		}
	}, [onTranscription, onProcessingStateChange])

	// Poll recording status while recording to update duration
	useEffect(() => {
		const pollRecordingStatus = async () => {
			try {
				const statusResponse = await VoiceServiceClient.getRecordingStatus(GetRecordingStatusRequest.create({}))
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
			// Start polling immediately, then every second
			pollRecordingStatus()
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

	const handleClick = useCallback(() => {
		if (disabled || isProcessing) return

		if (error) return setError(null)

		if (isRecording) {
			stopRecording()
		} else {
			startRecording()
		}
	}, [isRecording, startRecording, stopRecording, disabled, isProcessing, error])

	const getIconClass = () => {
		if (isProcessing) return "codicon-loading"
		if (isRecording) return "codicon-stop-circle"
		if (error) return "codicon-error"
		return "codicon-mic"
	}

	const getIconColor = () => {
		if (isRecording) return "var(--vscode-errorForeground)"
		if (error) return "var(--vscode-errorForeground)"
		return ""
	}

	const getIconAnimation = () => {
		if (isProcessing) return "animate-spin"
		if (isRecording) return "animate-pulse"
		return ""
	}

	const getIconAdjustment = () => {
		if (isProcessing) return "mt-0"
		if (isRecording) return "mt-1"
		if (error) return "mt-1"
		return "mt-0.5"
	}

	const getRecTooltipContent = () => {
		if (isProcessing) return "Transcribing..."
		if (isRecording) return `Stop Recording (${formatSeconds(recordingDuration)}/${formatSeconds(MAX_DURATION)})`
		if (error) return `Error: ${error}`
		return null
	}

	return (
		<HeroTooltip content={getRecTooltipContent()} placement="top">
			<div
				className={`input-icon-button mr-1.5 text-base ${getIconAdjustment()} ${getIconAnimation()} ${disabled || isProcessing ? "disabled" : ""}`}
				onClick={handleClick}
				style={{
					color: getIconColor(),
				}}>
				<span className={`codicon ${getIconClass()}`} />
			</div>
		</HeroTooltip>
	)
}

export default VoiceRecorder
