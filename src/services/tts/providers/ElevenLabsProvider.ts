import axios from "axios"
import { BaseTTSProvider, type TTSOptions, type TTSSynthesisResult, type TTSVoice, type TTSVoicesResult } from "./BaseTTSProvider"

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"

export interface STTTranscriptionResult {
	text?: string
	error?: string
}

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

	/**
	 * Transcribe audio to text using ElevenLabs Speech-to-Text API (Scribe v1 model)
	 * @param audioBuffer The audio data as a Buffer or Uint8Array
	 * @param language Optional language code (e.g., 'en', 'es', 'fr')
	 * @returns Transcription result with text or error
	 */
	async transcribeAudio(audioBuffer: Buffer | Uint8Array, language?: string): Promise<STTTranscriptionResult> {
		try {
			// Convert Uint8Array to Buffer if needed
			const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)

			// Create form data manually
			const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`

			// Build multipart form data body
			const parts: Buffer[] = []

			// Add audio file part - ElevenLabs expects field name "file"
			parts.push(Buffer.from(`--${boundary}\r\n`))
			parts.push(Buffer.from('Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n'))
			parts.push(Buffer.from("Content-Type: audio/webm\r\n\r\n"))
			parts.push(buffer)
			parts.push(Buffer.from("\r\n"))

			// Add language parameter if provided
			if (language) {
				parts.push(Buffer.from(`--${boundary}\r\n`))
				parts.push(Buffer.from('Content-Disposition: form-data; name="language"\r\n\r\n'))
				parts.push(Buffer.from(`${language}\r\n`))
			}

			// Add model parameter - Note: use underscore not hyphen
			parts.push(Buffer.from(`--${boundary}\r\n`))
			parts.push(Buffer.from('Content-Disposition: form-data; name="model_id"\r\n\r\n'))
			parts.push(Buffer.from("scribe_v1\r\n"))

			// Close boundary
			parts.push(Buffer.from(`--${boundary}--\r\n`))

			const body = Buffer.concat(parts)

			const response = await axios.post(`${ELEVENLABS_API_BASE}/speech-to-text`, body, {
				headers: {
					"xi-api-key": this.apiKey,
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				timeout: 120000, // 2 minute timeout for transcription
			})

			// Extract text from response (ElevenLabs returns detailed JSON with words, timestamps, etc.)
			const text = response.data?.text || ""

			return { text }
		} catch (error) {
			if (axios.isAxiosError(error)) {
				let errorMessage = error.message
				let errorDetails = ""

				if (error.response?.data) {
					if (typeof error.response.data === "string") {
						errorMessage = error.response.data
					} else if (error.response.data.detail) {
						if (typeof error.response.data.detail === "object") {
							errorMessage = JSON.stringify(error.response.data.detail, null, 2)
						} else {
							errorMessage = String(error.response.data.detail)
						}
					} else if (error.response.data.message) {
						errorMessage = String(error.response.data.message)
					} else if (error.response.data.error) {
						errorMessage = String(error.response.data.error)
					} else {
						// Try to extract useful error info
						try {
							errorDetails = JSON.stringify(error.response.data, null, 2)
							errorMessage = errorDetails
						} catch (e) {
							errorMessage = "Invalid response format"
						}
					}
				}

				// Add status code if available
				const statusCode = error.response?.status || "Unknown"
				const fullMessage = `${statusCode}: ${errorMessage}`

				console.error("[ElevenLabs STT] Full error details:", {
					status: error.response?.status,
					statusText: error.response?.statusText,
					data: error.response?.data,
					headers: error.response?.headers,
				})

				return {
					error: `ElevenLabs transcription error: ${fullMessage}`,
				}
			}
			return {
				error: `Failed to transcribe audio: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}
}
