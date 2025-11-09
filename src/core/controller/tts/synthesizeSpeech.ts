import type { SynthesizeRequest, SynthesizeResponse } from "../../../shared/proto/cline/tts"
import type { Controller } from ".."

/**
 * Synthesize speech from text using the configured TTS provider
 * @param controller The controller instance
 * @param request The synthesis request containing text and voice settings
 * @returns The synthesized audio data
 */
export async function synthesizeSpeech(controller: Controller, request: SynthesizeRequest): Promise<SynthesizeResponse> {
	try {
		// Get API key from secrets storage
		const apiKey = await controller.context.secrets.get("elevenLabsApiKey")

		if (!apiKey) {
			return {
				audioData: Buffer.alloc(0),
				contentType: "audio/mpeg",
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

		const result = await ttsService.synthesizeSpeech({
			voiceId: request.voiceId,
			text: request.text,
			speed: request.speed,
			stability: request.stability,
			similarityBoost: request.similarityBoost,
		})

		console.log("[synthesizeSpeech] TTS Service Result:", {
			audioDataLength: result.audioData?.length,
			audioDataType: typeof result.audioData,
			contentType: result.contentType,
			error: result.error,
		})

		// Protobuf-ts expects Uint8Array, not Buffer
		const audioUint8Array = new Uint8Array(result.audioData)
		console.log("[synthesizeSpeech] Created Uint8Array:", {
			arrayLength: audioUint8Array.length,
			arrayType: typeof audioUint8Array,
			isUint8Array: audioUint8Array instanceof Uint8Array,
		})

		const response: SynthesizeResponse = {
			audioData: audioUint8Array as any, // Protobuf bytes field accepts Uint8Array
			contentType: result.contentType,
			error: result.error,
		}

		console.log("[synthesizeSpeech] Returning response:", {
			audioDataLength: response.audioData?.length,
			hasAudioData: !!response.audioData,
			contentType: response.contentType,
			error: response.error,
		})

		return response
	} catch (error) {
		const emptyArray = new Uint8Array(0)
		return {
			audioData: emptyArray as any,
			contentType: "audio/mpeg",
			error: `Failed to synthesize speech: ${error instanceof Error ? error.message : "Unknown error"}`,
		}
	}
}

// Export with PascalCase for proto compatibility
export { synthesizeSpeech as SynthesizeSpeech }
