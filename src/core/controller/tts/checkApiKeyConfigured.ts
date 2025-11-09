import type { GetVoicesRequest, ValidateApiKeyResponse } from "../../../shared/proto/cline/tts"
import type { Controller } from ".."

/**
 * Check if TTS API key is configured and valid
 * @param controller The controller instance
 * @param request Empty request
 * @returns Whether an API key is configured and valid
 */
export async function checkApiKeyConfigured(controller: Controller, request: GetVoicesRequest): Promise<ValidateApiKeyResponse> {
	try {
		// Check if API key exists in secrets
		const apiKey = await controller.context.secrets.get("elevenLabsApiKey")

		console.log("[checkApiKeyConfigured] Checking API key:", {
			hasKey: !!apiKey,
			keyLength: apiKey?.length || 0,
		})

		if (!apiKey) {
			console.log("[checkApiKeyConfigured] No API key found in secrets")
			return {
				isValid: false,
				error: undefined, // No error, just not configured
			}
		}

		// API key exists, validate it
		const { TextToSpeechService } = await import("../../../services/tts/TextToSpeechService")
		const ttsService = new TextToSpeechService()

		await ttsService.initialize({
			provider: "elevenlabs",
			apiKey: apiKey,
		})

		// Quick validation check
		const isValid = await ttsService.validateApiKey()

		return {
			isValid,
			error: isValid ? undefined : "API key is invalid or expired",
		}
	} catch (error) {
		return {
			isValid: false,
			error: `Failed to check API key: ${error instanceof Error ? error.message : "Unknown error"}`,
		}
	}
}

// Export with PascalCase for proto compatibility
export { checkApiKeyConfigured as CheckApiKeyConfigured }
