import { TranscribeAudioRequest } from "@shared/proto/cline/dictation"
import { EmptyRequest } from "@shared/proto/index.cline"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { DictationServiceClient } from "@/services/grpc-client"
import { formatSeconds } from "@/utils/format"
import HeroTooltip from "../common/HeroTooltip"

interface VoiceRecorderProps {
	onTranscription: (text: string) => void
	onProcessingStateChange?: (isProcessing: boolean, message?: string) => void
	onRecordingStateChange?: (isRecording: boolean) => void
	disabled?: boolean
	language?: string
}

const MAX_DURATION = 5 * 60 // 5 minutes in seconds

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
	onTranscription,
	onProcessingStateChange,
	onRecordingStateChange,
	disabled = false,
	language = "en",
}) => {
	const [isRecording, setIsRecording] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [recordingDuration, setRecordingDuration] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

	// Notify parent when recording state changes
	useEffect(() => {
		onRecordingStateChange?.(isRecording)
	}, [isRecording, onRecordingStateChange])

	const startRecording = useCallback(async () => {
		try {
			setIsRecording(true)
			setError(null) // Clear any previous errors
			onProcessingStateChange?.(false) // Clear any previous processing state
			setRecordingDuration(0) // Reset recording duration

			// Call Extension Host to start recording
			const response = await DictationServiceClient.startRecording(EmptyRequest.create({}))

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
				console.error("No audio data received")
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
				console.error("Transcription error:", transcriptionResponse.error)
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
		if (disabled || isProcessing) return
		if (error) return setError(null)
		startRecording()
	}, [startRecording, disabled, isProcessing, error])

	const handleCancelClick = useCallback(() => {
		if (disabled || isProcessing) return
		cancelRecording()
	}, [cancelRecording, disabled, isProcessing])

	const handleStopClick = useCallback(() => {
		if (disabled || isProcessing) return
		stopRecording()
	}, [stopRecording, disabled, isProcessing])

	// When not recording, show single mic button
	if (!isRecording) {
		const iconClass = isProcessing ? "codicon-loading" : error ? "codicon-error" : "codicon-mic"
		const iconColor = error ? "var(--vscode-errorForeground)" : ""
		const iconAnimation = isProcessing ? "animate-spin" : ""
		const iconAdjustment = isProcessing ? "mt-0" : error ? "mt-1" : "mt-0.5"
		const tooltipContent = isProcessing ? "Transcribing..." : error ? `Error: ${error}` : null

		return (
			<HeroTooltip content={tooltipContent} placement="top">
				<div
					className={`input-icon-button mr-1.5 text-base ${iconAdjustment} ${iconAnimation} ${disabled || isProcessing ? "disabled" : ""}`}
					onClick={handleStartClick}
					style={{ color: iconColor }}>
					<span className={`codicon ${iconClass}`} />
				</div>
			</HeroTooltip>
		)
	}

	return (
		<div className={`flex items-center ${isRecording ? "mr-0.5" : "mr-1.5"}`}>
			<HeroTooltip
				content={`Stop Recording (${formatSeconds(recordingDuration)}/${formatSeconds(MAX_DURATION)})`}
				placement="top">
				<div
					className={`input-icon-button text-base mr-1 mt-1 animate-pulse text-[var(--vscode-errorForeground)] ${disabled || isProcessing ? "disabled" : ""}`}
					onClick={handleStopClick}>
					<span className="codicon codicon-stop-circle" />
				</div>
			</HeroTooltip>
			<HeroTooltip content="Cancel Recording" placement="top">
				<div
					className={`input-icon-button text-base mt-1 text-[var(--vscode-textForeground)] ${disabled || isProcessing ? "disabled" : ""}`}
					onClick={handleCancelClick}>
					<span className="codicon codicon-close" />
				</div>
			</HeroTooltip>
		</div>
	)
}

export default VoiceRecorder
