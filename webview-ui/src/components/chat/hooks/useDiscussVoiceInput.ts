import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DictationServiceClient } from "@/services/grpc-client"

/**
 * Custom hook for handling voice input in Discuss Mode
 * Leverages the existing DictationService infrastructure for recording and transcription
 */
export function useDiscussVoiceInput() {
	const [isRecording, setIsRecording] = useState(false)
	const [isTranscribing, setIsTranscribing] = useState(false)
	const [recordingDuration, setRecordingDuration] = useState(0)
	const [error, setError] = useState<string | null>(null)
	const { discussModeEnabled, dictationSettings } = useExtensionState()

	// Auto-update recording duration while recording
	useEffect(() => {
		if (!isRecording) return

		const interval = setInterval(async () => {
			try {
				const status = await DictationServiceClient.getRecordingStatus({})
				setRecordingDuration(status.durationSeconds)
			} catch (err) {
				console.error("Failed to get recording status:", err)
			}
		}, 100)

		return () => clearInterval(interval)
	}, [isRecording])

	/**
	 * Starts audio recording
	 */
	const startRecording = useCallback(async () => {
		try {
			setError(null)
			const result = await DictationServiceClient.startRecording({})

			if (result.success) {
				setIsRecording(true)
			} else {
				setError(result.error || "Failed to start recording")
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : "Failed to start recording"
			setError(errorMessage)
			console.error("Start recording error:", err)
		}
	}, [])

	/**
	 * Stops recording and transcribes the audio
	 * @param onTranscriptionComplete - Callback with transcribed text
	 */
	const stopRecording = useCallback(
		async (onTranscriptionComplete: (text: string) => void) => {
			try {
				setIsRecording(false)
				setIsTranscribing(true)
				setError(null)

				// Stop recording and get audio data
				const audioResult = await DictationServiceClient.stopRecording({})

				if (!audioResult.success || !audioResult.audioBase64) {
					setError(audioResult.error || "Failed to capture audio")
					setIsTranscribing(false)
					return
				}

				// Transcribe the audio
				const transcription = await DictationServiceClient.transcribeAudio({
					audioBase64: audioResult.audioBase64,
					language: dictationSettings?.dictationLanguage || "en",
				})

				if (transcription.error) {
					setError(transcription.error)
				} else if (transcription.text) {
					// Successfully transcribed - pass text to callback
					onTranscriptionComplete(transcription.text)
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Transcription failed"
				setError(errorMessage)
				console.error("Transcription error:", err)
			} finally {
				setIsTranscribing(false)
				setRecordingDuration(0)
			}
		},
		[dictationSettings],
	)

	/**
	 * Cancels the current recording without transcribing
	 */
	const cancelRecording = useCallback(async () => {
		try {
			await DictationServiceClient.cancelRecording({})
			setIsRecording(false)
			setRecordingDuration(0)
			setError(null)
		} catch (err) {
			console.error("Cancel recording error:", err)
		}
	}, [])

	/**
	 * Clears any error messages
	 */
	const clearError = useCallback(() => {
		setError(null)
	}, [])

	// Check if voice input is available
	// Requires both Discuss Mode to be enabled and platform support (currently macOS only)
	const isAvailable = discussModeEnabled && (dictationSettings?.featureEnabled ?? false)

	return {
		isRecording,
		isTranscribing,
		recordingDuration,
		error,
		isAvailable,
		startRecording,
		stopRecording,
		cancelRecording,
		clearError,
	}
}
