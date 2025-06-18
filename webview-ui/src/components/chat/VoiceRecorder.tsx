import React, { useState, useCallback } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { VoiceServiceClient } from "@/services/grpc-client"
import { StartRecordingRequest, StopRecordingRequest, TranscribeAudioRequest } from "@shared/proto/voice"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Tooltip from "@/components/common/Tooltip"

interface VoiceRecorderProps {
	onTranscription: (text: string) => void
	onProcessingStateChange?: (isProcessing: boolean, message?: string) => void
	disabled?: boolean
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onTranscription, onProcessingStateChange, disabled = false }) => {
	const { chatSettings } = useExtensionState()
	const [isRecording, setIsRecording] = useState(false)
	const [isProcessing, setIsProcessing] = useState(false)

	const startRecording = useCallback(async () => {
		try {
			setIsRecording(true)
			onProcessingStateChange?.(false) // Clear any previous processing state

			// Call Extension Host to start recording
			const response = await (VoiceServiceClient as any).StartRecording(StartRecordingRequest.create({}))

			if (!response.success) {
				console.error("Failed to start recording:", response.error)
				setIsRecording(false)
				return
			}

			console.log("Recording started successfully")
		} catch (error) {
			console.error("Error starting recording:", error)
			setIsRecording(false)
		}
	}, [onProcessingStateChange])

	const stopRecording = useCallback(async () => {
		try {
			setIsRecording(false)
			setIsProcessing(true)
			onProcessingStateChange?.(true, "Processing...")

			// Call Extension Host to stop recording and get audio
			const response = await (VoiceServiceClient as any).StopRecording(StopRecordingRequest.create({}))

			if (!response.success) {
				console.error("Failed to stop recording:", response.error)
				setIsProcessing(false)
				onProcessingStateChange?.(false)
				return
			}

			if (!response.audioBase64) {
				console.error("No audio data received")
				setIsProcessing(false)
				onProcessingStateChange?.(false)
				return
			}

			// Update processing state for transcription
			onProcessingStateChange?.(true, "Transcribing...")

			// Transcribe the audio using OpenAI Whisper
			const transcriptionResponse = await (VoiceServiceClient as any).TranscribeAudio(
				TranscribeAudioRequest.create({
					audioBase64: response.audioBase64,
					language: "en",
				}),
			)

			if (transcriptionResponse.error) {
				console.error("Transcription error:", transcriptionResponse.error)
			} else if (transcriptionResponse.text) {
				onTranscription(transcriptionResponse.text)
			}
		} catch (error) {
			console.error("Error stopping recording:", error)
		} finally {
			setIsProcessing(false)
			onProcessingStateChange?.(false)
		}
	}, [onTranscription, onProcessingStateChange])

	const handleClick = useCallback(() => {
		if (isRecording) {
			stopRecording()
		} else {
			startRecording()
		}
	}, [isRecording, startRecording, stopRecording])

	return (
		<Tooltip tipText={isRecording ? "Stop Recording" : "Start Voice Recording"} hintText="Record your message">
			<VSCodeButton
				appearance="icon"
				aria-label={isRecording ? "Stop Recording" : "Start Voice Recording"}
				disabled={disabled || isProcessing}
				onClick={handleClick}
				style={{
					padding: "0px 0px",
					height: "20px",
					opacity: isProcessing ? 0.5 : 1,
				}}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						fontSize: "10px",
						gap: "2px",
					}}>
					<span
						className={`codicon ${isRecording ? "codicon-stop-circle animate-pulse" : "codicon-mic"}`}
						style={{
							fontSize: "14px",
							color: isRecording ? "var(--vscode-errorForeground)" : undefined,
						}}
					/>
					{isProcessing && <span>Processing...</span>}
				</div>
			</VSCodeButton>
		</Tooltip>
	)
}

export default VoiceRecorder
