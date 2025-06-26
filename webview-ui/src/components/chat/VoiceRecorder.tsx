import React, { useState, useCallback } from "react"
import { VoiceServiceClient } from "@/services/grpc-client"
import { StartRecordingRequest, StopRecordingRequest, TranscribeAudioRequest } from "@shared/proto/voice"

interface VoiceRecorderProps {
	onTranscription: (text: string) => void
	onProcessingStateChange?: (isProcessing: boolean, message?: string) => void
	disabled?: boolean
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onTranscription, onProcessingStateChange, disabled = false }) => {
	const [isRecording, setIsRecording] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const startRecording = useCallback(async () => {
		try {
			setIsRecording(true)
			setError(null) // Clear any previous errors
			onProcessingStateChange?.(false) // Clear any previous processing state

			// Call Extension Host to start recording
			const response = await (VoiceServiceClient as any).startRecording(StartRecordingRequest.create({}))

			if (!response.success) {
				console.error("Failed to start recording:", response.error)
				setIsRecording(false)
				setError(response.error || "Failed to start recording")
				onProcessingStateChange?.(true, response.error || "Failed to start recording")
				return
			}

			console.log("Recording started successfully")
		} catch (error) {
			console.error("Error starting recording:", error)
			setIsRecording(false)
			const errorMessage = error instanceof Error ? error.message : "Failed to start recording"
			setError(errorMessage)
			onProcessingStateChange?.(true, errorMessage)
		}
	}, [onProcessingStateChange])

	const stopRecording = useCallback(async () => {
		try {
			setIsRecording(false)
			setIsProcessing(true)
			onProcessingStateChange?.(true, "Processing...")

			// Call Extension Host to stop recording and get audio
			const response = await (VoiceServiceClient as any).stopRecording(StopRecordingRequest.create({}))

			if (!response.success) {
				console.error("Failed to stop recording:", response.error)
				setIsProcessing(false)
				const errorMessage = response.error || "Failed to stop recording"
				setError(errorMessage)
				onProcessingStateChange?.(true, errorMessage)
				return
			}

			if (!response.audioBase64) {
				console.error("No audio data received")
				setIsProcessing(false)
				const errorMessage = "No audio data received"
				setError(errorMessage)
				onProcessingStateChange?.(true, errorMessage)
				return
			}

			// Update processing state for transcription
			onProcessingStateChange?.(true, "Transcribing...")

			// Transcribe the audio using OpenAI Whisper
			const transcriptionResponse = await (VoiceServiceClient as any).transcribeAudio(
				TranscribeAudioRequest.create({
					audioBase64: response.audioBase64,
					language: "en",
				}),
			)

			if (transcriptionResponse.error) {
				console.error("Transcription error:", transcriptionResponse.error)
				setError(transcriptionResponse.error)
				// Show the error message in the UI
				onProcessingStateChange?.(true, transcriptionResponse.error)
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
			onProcessingStateChange?.(true, errorMessage)
		} finally {
			setIsProcessing(false)
		}
	}, [onTranscription, onProcessingStateChange])

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
		return undefined
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

	return (
		<div
			className={`input-icon-button mr-1.5 text-base ${getIconAdjustment()} ${getIconAnimation()} ${disabled || isProcessing ? "disabled" : ""}`}
			onClick={handleClick}
			style={{
				color: getIconColor(),
			}}>
			<span className={`codicon ${getIconClass()}`} />
		</div>
	)
}

export default VoiceRecorder
