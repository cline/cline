import { Controller } from ".."
import { TranscribeAudioRequest, Transcription } from "@shared/proto/voice"
import { voiceTranscriptionService } from "@/services/dictation/VoiceTranscriptionService"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { VoiceMethodHandler } from "./index"
import * as vscode from "vscode"

/**
 * Transcribes audio using Cline transcription service
 * @param controller The controller instance
 * @param request TranscribeAudioRequest containing base64 audio data
 * @returns Transcription with transcribed text or error
 */
export const transcribeAudio: VoiceMethodHandler = async (
	controller: Controller,
	request: TranscribeAudioRequest,
): Promise<Transcription> => {
	const taskId = controller.task?.taskId
	const startTime = Date.now()

	// Calculate audio size from base64
	const audioSizeBytes = Math.ceil((request.audioBase64.length * 3) / 4)

	// Capture telemetry for transcription start
	telemetryService.captureVoiceTranscriptionStarted(taskId, audioSizeBytes, request.language || "en")

	try {
		// Transcribe the audio
		const result = await voiceTranscriptionService.transcribeAudio(request.audioBase64, request.language || undefined)
		const durationMs = Date.now() - startTime

		// Handle transcription result
		if (result.error) {
			// Determine error type for telemetry
			let errorType = "api_error"
			if (result.error.includes("Authentication failed")) {
				errorType = "invalid_jwt_token"
			} else if (result.error.includes("Insufficient credits")) {
				errorType = "insufficient_credits"
			} else if (result.error.includes("Invalid audio format")) {
				errorType = "invalid_audio_format"
			} else if (result.error.includes("Cannot connect")) {
				errorType = "connection_error"
			} else if (result.error.includes("Network error")) {
				errorType = "network_error"
			}

			// Capture telemetry for transcription error
			telemetryService.captureVoiceTranscriptionError(taskId, errorType, result.error, durationMs)

			// Show error notification if transcription failed
			if (result.error.includes("Authentication failed")) {
				vscode.window.showErrorMessage("Authentication failed. ")
			} else if (result.error.includes("Insufficient credits")) {
				vscode.window.showWarningMessage("Insufficient credits for transcription service.")
			} else if (result.error.includes("Cannot connect")) {
				vscode.window.showErrorMessage("Cannot connect to transcription service. ")
			} else {
				vscode.window.showErrorMessage(`Voice transcription failed: ${result.error}`)
			}
		} else if (result.text) {
			// Capture telemetry for successful transcription
			telemetryService.captureVoiceTranscriptionCompleted(taskId, result.text.length, durationMs, request.language || "en")
		}

		// Return the response
		return Transcription.create({
			text: result.text || "",
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error transcribing audio:", error)
		const durationMs = Date.now() - startTime
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"

		// Capture telemetry for unexpected error
		telemetryService.captureVoiceTranscriptionError(taskId, "unexpected_error", errorMessage, durationMs)

		return Transcription.create({
			text: "",
			error: errorMessage,
		})
	}
}
