import { Controller } from ".."
import { TranscribeAudioRequest, TranscribeAudioResponse } from "@shared/proto/voice"
import { voiceTranscriptionService } from "@services/voice/VoiceTranscriptionService"
import { VoiceMethodHandler } from "./index"

/**
 * Transcribes audio using OpenAI's Whisper model
 * This will automatically use any available OpenAI API key, regardless of the current chat provider
 * @param controller The controller instance
 * @param request TranscribeAudioRequest containing base64 audio data
 * @returns TranscribeAudioResponse with transcribed text or error
 */
export const TranscribeAudio: VoiceMethodHandler = async (
	controller: Controller,
	request: TranscribeAudioRequest,
): Promise<TranscribeAudioResponse> => {
	try {
		// Initialize the voice service with any available OpenAI key
		const initResult = await voiceTranscriptionService.initializeWithAnyOpenAIKey(controller.context)

		if (!initResult.success) {
			return TranscribeAudioResponse.create({
				text: "",
				error: initResult.error || "Failed to initialize voice transcription service",
			})
		}

		// Transcribe the audio
		const result = await voiceTranscriptionService.transcribeAudio(request.audioBase64, request.language || undefined)

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
