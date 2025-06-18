import { Controller } from ".."
import { TranscribeAudioRequest, TranscribeAudioResponse } from "@shared/proto/voice"
import { voiceTranscriptionService } from "@services/voice/VoiceTranscriptionService"
import { VoiceMethodHandler } from "./index"
import * as vscode from "vscode"

/**
 * Transcribes audio using OpenAI's Whisper model
 * This will automatically use any available OpenAI API key, regardless of the current chat provider
 * @param controller The controller instance
 * @param request TranscribeAudioRequest containing base64 audio data
 * @returns TranscribeAudioResponse with transcribed text or error
 */
export const transcribeAudio: VoiceMethodHandler = async (
	controller: Controller,
	request: TranscribeAudioRequest,
): Promise<TranscribeAudioResponse> => {
	try {
		// Initialize the voice service with any available OpenAI key
		const initResult = await voiceTranscriptionService.initializeWithAnyOpenAIKey(controller.context)

		if (!initResult.success) {
			const errorMessage = initResult.error || "Failed to initialize voice transcription service"

			// Show appropriate VSCode notification based on the error
			if (errorMessage.includes("No OpenAI API key found")) {
				vscode.window.showErrorMessage(
					"Voice transcription requires an OpenAI API key. Please configure one in Cline settings.",
				)
			} else {
				vscode.window.showErrorMessage(`Voice transcription failed: ${errorMessage}`)
			}

			return TranscribeAudioResponse.create({
				text: "",
				error: errorMessage,
			})
		}

		// Transcribe the audio
		const result = await voiceTranscriptionService.transcribeAudio(request.audioBase64, request.language || undefined)

		// Show error notification if transcription failed
		if (result.error) {
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
		}

		// Return the response
		return TranscribeAudioResponse.create({
			text: result.text || "",
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error transcribing audio:", error)
		return TranscribeAudioResponse.create({
			text: "",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
