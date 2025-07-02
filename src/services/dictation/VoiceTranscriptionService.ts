import { Logger } from "@services/logging/Logger"
import axios from "axios"

const JWT_TOKEN = ""

const TRANSCRIPTION_ENDPOINT = ""

export class VoiceTranscriptionService {
	constructor() {}

	async transcribeAudio(audioBase64: string, language?: string): Promise<{ text?: string; error?: string }> {
		try {
			if (!JWT_TOKEN) {
				return {
					error: "JWT token not configured. Please set your JWT token in VoiceTranscriptionService.ts",
				}
			}

			Logger.info("Transcribing audio with localhost endpoint...")

			// Make request to localhost transcription endpoint
			const response = await axios.post(
				TRANSCRIPTION_ENDPOINT,
				{
					audioData: audioBase64,
				},
				{
					headers: {
						Authorization: `Bearer ${JWT_TOKEN}`,
						"Content-Type": "application/json",
					},
					timeout: 30000, // 30 second timeout
				},
			)

			const transcription = response.data

			// Extract text from response
			const text = transcription?.data?.text

			if (!text || !transcription.success) {
				return { error: "Transcription service failed. Please try again." }
			}

			Logger.info("Transcription successful")

			return { text }
		} catch (error) {
			Logger.error("Voice transcription error:", error)

			// Handle axios errors with proper status code mapping
			if (axios.isAxiosError(error)) {
				const status = error.response?.status
				const message = error.response?.data?.message || error.message

				switch (status) {
					case 401:
						return { error: "Authentication failed. Please reauthenticate your Cline account" }
					case 402:
						return { error: "Insufficient credits for transcription service." }
					case 400:
						return { error: "Invalid audio format or request data." }
					case 500:
						return { error: "Transcription server error. Please try again later." }
					default:
						return { error: `Transcription failed: ${message}` }
				}
			}

			// Handle network errors
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("Network Error")) {
				return { error: "Cannot connect to transcription service." }
			}

			return { error: `Network error: ${errorMessage}` }
		}
	}
}

export const voiceTranscriptionService = new VoiceTranscriptionService()
