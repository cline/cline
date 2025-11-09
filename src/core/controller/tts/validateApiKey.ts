import type { ValidateApiKeyRequest, ValidateApiKeyResponse } from "../../../shared/proto/cline/tts"
import type { Controller } from ".."

/**
 * Validate the TTS API key
 * @param controller The controller instance
 * @param request The validation request (currently empty)
 * @returns Whether the API key is valid
 */
export async function validateApiKey(controller: Controller, request: ValidateApiKeyRequest): Promise<ValidateApiKeyResponse> {
	try {
		const apiKey = request.apiKey

		if (!apiKey || apiKey.trim() === "") {
			return {
				isValid: false,
				error: "API key is required",
			}
		}

		console.log("[validateApiKey] Saving API key to secrets storage...")
		// Save the API key to secrets storage
		await controller.context.secrets.store("elevenLabsApiKey", apiKey)
		console.log("[validateApiKey] API key saved successfully")

		// Initialize TTS service with the new key
		const { TextToSpeechService } = await import("../../../services/tts/TextToSpeechService")
		const ttsService = new TextToSpeechService()

		await ttsService.initialize({
			provider: "elevenlabs",
			apiKey: apiKey,
		})

		// Validate the API key by attempting to fetch voices
		// Also try to get voices to provide better error feedback
		const voicesResult = await ttsService.getAvailableVoices()

		if (voicesResult.error) {
			return {
				isValid: false,
				error: voicesResult.error,
			}
		}

		// If we got voices successfully, the key is valid
		return {
			isValid: true,
			error: undefined,
		}
	} catch (error) {
		return {
			isValid: false,
			error: `Failed to validate API key: ${error instanceof Error ? error.message : "Unknown error"}`,
		}
	}
}

// Export with PascalCase for proto compatibility
export { validateApiKey as ValidateApiKey }
