import { Controller } from ".."
import { TranscribeAudioRequest, Transcription } from "@shared/proto/voice"
import { voiceTranscriptionService } from "@services/voice/VoiceTranscriptionService"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { VoiceMethodHandler } from "./index"
import * as vscode from "vscode"

/**
 * Transcribes audio using OpenAI's Whisper model
 * This will automatically use any available OpenAI API key, regardless of the current chat provider
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
		// Initialize the voice service with any available OpenAI key
		const initResult = await voiceTranscriptionService.initializeWithAnyOpenAIKey(controller.context)

		if (!initResult.success) {
			const errorMessage = initResult.error || "Failed to initialize voice transcription service"
			const durationMs = Date.now() - startTime

			// Determine error type
			let errorType = "initialization_error"
			if (errorMessage.includes("No OpenAI API key found")) {
				errorType = "no_openai_key"
			}

			// Capture telemetry for transcription error
			telemetryService.captureVoiceTranscriptionError(taskId, errorType, errorMessage, durationMs)

			// Show appropriate VSCode notification based on the error
			if (errorMessage.includes("No OpenAI API key found")) {
				vscode.window.showErrorMessage(
					"Voice transcription requires an OpenAI API key. Please configure one in Cline settings.",
				)
			} else {
				vscode.window.showErrorMessage(`Voice transcription failed: ${errorMessage}`)
			}

			return Transcription.create({
				text: "",
				error: errorMessage,
			})
		}

		// Transcribe the audio
		const result = await voiceTranscriptionService.transcribeAudio(request.audioBase64, request.language || undefined)
		const durationMs = Date.now() - startTime

		// Handle transcription result
		if (result.error) {
			// Determine error type for telemetry
			let errorType = "api_error"
			if (result.error.includes("Invalid OpenAI API key")) {
				errorType = "invalid_api_key"
			} else if (result.error.includes("rate limit exceeded")) {
				errorType = "rate_limit"
			} else if (result.error.includes("quota exceeded")) {
				errorType = "quota_exceeded"
			} else if (result.error.includes("Whisper model")) {
				errorType = "whisper_model_error"
			} else if (result.error.includes("network")) {
				errorType = "network_error"
			}

			// Capture telemetry for transcription error
			telemetryService.captureVoiceTranscriptionError(taskId, errorType, result.error, durationMs)

			// Show error notification if transcription failed
			if (result.error.includes("Invalid OpenAI API key")) {
				vscode.window.showErrorMessage("Invalid OpenAI API key. Please check your API key in Cline settings.")
			} else if (result.error.includes("rate limit exceeded")) {
				vscode.window.showWarningMessage("OpenAI API rate limit exceeded. Please wait a moment and try again.")
			} else if (result.error.includes("quota exceeded")) {
				vscode.window
					.showErrorMessage(
						"OpenAI API quota exceeded. Please check your billing settings on OpenAI.",
						"Open OpenAI Billing",
					)
					.then((selection) => {
						if (selection === "Open OpenAI Billing") {
							vscode.env.openExternal(vscode.Uri.parse("https://platform.openai.com/account/billing"))
						}
					})
			} else if (result.error.includes("Whisper model")) {
				vscode.window.showErrorMessage(
					"Voice transcription requires OpenAI's Whisper model. Please ensure you have a valid OpenAI API key.",
				)
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
