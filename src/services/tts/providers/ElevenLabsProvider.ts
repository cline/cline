import axios from "axios"
import { BaseTTSProvider, type TTSOptions, type TTSSynthesisResult, type TTSVoice, type TTSVoicesResult } from "./BaseTTSProvider"

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"

/**
 * ElevenLabs Text-to-Speech Provider
 * Implements TTS using ElevenLabs API
 */
export class ElevenLabsProvider extends BaseTTSProvider {
	/**
	 * Synthesize speech from text using ElevenLabs API
	 */
	async synthesizeSpeech(options: TTSOptions): Promise<TTSSynthesisResult> {
		try {
			const { voiceId, text, speed = 1.0, stability = 0.5, similarityBoost = 0.75 } = options

			const response = await axios.post(
				`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`,
				{
					text,
					model_id: "eleven_multilingual_v2",
					voice_settings: {
						stability,
						similarity_boost: similarityBoost,
						speed,
					},
				},
				{
					headers: {
						"xi-api-key": this.apiKey,
						"Content-Type": "application/json",
						Accept: "audio/mpeg",
					},
					responseType: "arraybuffer",
					timeout: 30000, // 30 second timeout
				},
			)

			return {
				audioData: new Uint8Array(response.data),
				contentType: response.headers["content-type"] || "audio/mpeg",
			}
		} catch (error) {
			if (axios.isAxiosError(error)) {
				const errorMessage = error.response?.data ? new TextDecoder().decode(error.response.data) : error.message
				return {
					audioData: new Uint8Array(0),
					contentType: "audio/mpeg",
					error: `ElevenLabs API error: ${errorMessage}`,
				}
			}
			return {
				audioData: new Uint8Array(0),
				contentType: "audio/mpeg",
				error: `Failed to synthesize speech: ${error instanceof Error ? error.message : "Unknown error"}`,
			}
		}
	}

	/**
	 * Get list of available voices from ElevenLabs
	 */
	async getAvailableVoices(): Promise<TTSVoicesResult> {
		try {
			const response = await axios.get(`${ELEVENLABS_API_BASE}/voices`, {
				headers: {
					"xi-api-key": this.apiKey,
				},
				timeout: 10000,
			})

			const voices: TTSVoice[] = response.data.voices.map((voice: any) => ({
				id: voice.voice_id,
				name: voice.name,
				description: voice.labels?.description || voice.category,
				previewUrl: voice.preview_url,
			}))

			return { voices }
		} catch (error) {
			if (axios.isAxiosError(error)) {
				// Extract error message from different possible sources
				let errorMessage = error.message

				if (error.response?.data) {
					if (typeof error.response.data === "string") {
						errorMessage = error.response.data
					} else if (error.response.data.detail) {
						errorMessage = error.response.data.detail
					} else if (error.response.data.message) {
						errorMessage = error.response.data.message
					} else {
						errorMessage = JSON.stringify(error.response.data)
					}
				}

				// Add status code if available
				if (error.response?.status) {
					errorMessage = `${error.response.status}: ${errorMessage}`
				}

				return {
					voices: [],
					error: `Failed to fetch voices: ${errorMessage}`,
				}
			}
			return {
				voices: [],
				error: `Failed to fetch voices: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Validate API key by attempting to fetch voices
	 */
	async validateApiKey(): Promise<boolean> {
		try {
			await axios.get(`${ELEVENLABS_API_BASE}/voices`, {
				headers: {
					"xi-api-key": this.apiKey,
				},
				timeout: 5000,
			})
			return true
		} catch (error) {
			return false
		}
	}
}
