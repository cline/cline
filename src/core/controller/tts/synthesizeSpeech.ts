import type { SynthesizeRequest, SynthesizeResponse } from "../../../shared/proto/tts"
import type { Controller } from ".."

/**
 * Synthesize speech from text using the configured TTS provider
 * @param controller The controller instance
 * @param request The synthesis request containing text and voice settings
 * @returns The synthesized audio data
 */
export async function synthesizeSpeech(controller: Controller, request: SynthesizeRequest): Promise<SynthesizeResponse> {
	try {
		const ttsService = controller.getTtsService()

		if (!ttsService || !ttsService.isInitialized()) {
			return {
				audioData: Buffer.from(new Uint8Array(0)),
				contentType: "audio/mpeg",
				error: "TTS service not initialized. Please configure TTS settings first.",
			}
		}

		const result = await ttsService.synthesizeSpeech({
			voiceId: request.voiceId,
			text: request.text,
			speed: request.speed,
			stability: request.stability,
			similarityBoost: request.similarityBoost,
		})

		return {
			audioData: result.audioData,
			contentType: result.contentType,
			error: result.error,
		}
	} catch (error) {
		return {
			audioData: Buffer.from(new Uint8Array(0)),
			contentType: "audio/mpeg",
			error: `Failed to synthesize speech: ${error instanceof Error ? error.message : "Unknown error"}`,
		}
	}
}
