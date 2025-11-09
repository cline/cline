import type { GetVoicesRequest, VoicesResponse } from "../../../shared/proto/tts"
import type { Controller } from ".."

/**
 * Get list of available voices for the current TTS provider
 * @param controller The controller instance
 * @param request The request (currently empty)
 * @returns List of available voices
 */
export async function getAvailableVoices(controller: Controller, request: GetVoicesRequest): Promise<VoicesResponse> {
	try {
		const ttsService = controller.getTtsService()

		if (!ttsService || !ttsService.isInitialized()) {
			return {
				voices: [],
				error: "TTS service not initialized. Please configure TTS settings first.",
			}
		}

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
