import { Logger } from "@services/logging/Logger"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import axios from "axios"

export class VoiceTranscriptionService {
	private clineAccountService: ClineAccountService

	constructor() {
		this.clineAccountService = ClineAccountService.getInstance()
	}

	async transcribeAudio(audioBase64: string, language?: string): Promise<{ text?: string; error?: string }> {
		try {
			Logger.info("Transcribing audio with Cline transcription service...")

			const result = await this.clineAccountService.transcribeAudio(audioBase64, language)

			Logger.info("Transcription successful")

			return { text: result.text }
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
