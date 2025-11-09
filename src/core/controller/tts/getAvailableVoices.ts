import type { GetVoicesRequest, VoicesResponse } from "../../../shared/proto/cline/tts"
import type { Controller } from ".."

/**
 * Get list of available voices for the current TTS provider
 * @param controller The controller instance
 * @param request The request (currently empty)
 * @returns List of available voices
 */
export async function getAvailableVoices(controller: Controller, request: GetVoicesRequest): Promise<VoicesResponse> {
	try {
		// Get API key from secrets storage
		const apiKey = await controller.context.secrets.get("elevenLabsApiKey")

		if (!apiKey) {
			return {
				voices: [],
				error: "No API key found. Please validate your API key first.",
			}
		}

		// Initialize TTS service with the stored key
		const { TextToSpeechService } = await import("../../../services/tts/TextToSpeechService")
		const ttsService = new TextToSpeechService()

		await ttsService.initialize({
			provider: "elevenlabs",
			apiKey: apiKey,
		})

		const result = await ttsService.getAvailableVoices()

		return {
			voices: result.voices.map((voice) => ({
				id: voice.id,
				name: voice.name,
				description: voice.description,
				previewUrl: voice.previewUrl,
			})),
			error: result.error,
		}
	} catch (error) {
		return {
			voices: [],
			error: `Failed to fetch voices: ${error instanceof Error ? error.message : "Unknown error"}`,
		}
	}
}

// Export with PascalCase for proto compatibility
export { getAvailableVoices as GetAvailableVoices }
