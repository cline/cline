import { azureOpenAiDefaultApiVersion } from "@shared/api"
import { Logger } from "@services/logging/Logger"
import OpenAI, { AzureOpenAI } from "openai"
import * as vscode from "vscode"

export class VoiceTranscriptionService {
	private client: OpenAI | null = null

	constructor() {
		// Client will be initialized when needed
	}

	/**
	 * Initialize the service with any available OpenAI API key from the extension's configuration
	 * This searches for OpenAI keys regardless of the current chat provider
	 */
	async initializeWithAnyOpenAIKey(context: vscode.ExtensionContext): Promise<{ success: boolean; error?: string }> {
		try {
			// Import here to avoid circular dependencies
			const { getSecret } = await import("@core/storage/state")

			const openAiNativeApiKey = await getSecret(context, "openAiNativeApiKey")

			// Use whichever key is available
			const apiKey = openAiNativeApiKey

			if (!apiKey) {
				return {
					success: false,
					error: "No OpenAI API key found. Please configure an OpenAI API key in settings to use voice transcription.",
				}
			}

			// Check if this is an Azure endpoint
			this.client = new OpenAI({
				apiKey: openAiNativeApiKey,
			})

			Logger.info("Voice transcription service initialized with available OpenAI key")
			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Failed to initialize voice transcription service:", error)
			return { success: false, error: errorMessage }
		}
	}

	private base64ToBlob(base64: string, mimeType: string = "audio/wav"): Blob {
		// Remove data URL prefix if present
		const base64Data = base64.replace(/^data:audio\/\w+;base64,/, "")
		const byteCharacters = atob(base64Data)
		const byteNumbers = new Array(byteCharacters.length)

		for (let i = 0; i < byteCharacters.length; i++) {
			byteNumbers[i] = byteCharacters.charCodeAt(i)
		}

		const byteArray = new Uint8Array(byteNumbers)
		return new Blob([byteArray], { type: mimeType })
	}

	async transcribeAudio(audioBase64: string, language?: string): Promise<{ text?: string; error?: string }> {
		try {
			if (!this.client) {
				return {
					error: "Voice transcription service not initialized. Please ensure you have an OpenAI API key configured.",
				}
			}

			// Convert base64 to blob (we're recording as WAV)
			const audioBlob = this.base64ToBlob(audioBase64, "audio/wav")

			// Create a File object from the blob (OpenAI SDK expects File, not Blob)
			const audioFile = new File([audioBlob], "audio.wav", { type: "audio/wav" })

			Logger.info("Transcribing audio with OpenAI Whisper...")

			// Use OpenAI's transcription API
			// IMPORTANT: Must use whisper-1 model for audio transcription
			const response = await this.client.audio.transcriptions.create({
				file: audioFile,
				model: "whisper-1", // This is the ONLY model that supports audio transcription
				language: language, // optional language hint
			})

			Logger.info("Transcription successful")

			return { text: response.text }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Voice transcription error:", error)

			// Provide user-friendly error messages
			if (errorMessage.includes("401")) {
				return { error: "Invalid OpenAI API key. Please check your OpenAI API configuration." }
			} else if (errorMessage.includes("429")) {
				return { error: "OpenAI API rate limit exceeded. Please try again later." }
			} else if (errorMessage.includes("insufficient_quota")) {
				return { error: "OpenAI API quota exceeded. Please check your billing settings." }
			} else if (errorMessage.includes("400") && errorMessage.includes("o3-mini")) {
				return {
					error: "Voice transcription requires OpenAI's Whisper model. Please ensure you have a valid OpenAI API key configured.",
				}
			} else if (errorMessage.includes("does not work with the specified model")) {
				return {
					error: "Voice transcription requires OpenAI's Whisper model. Please ensure you have a valid OpenAI API key configured.",
				}
			}

			return { error: `Transcription failed: ${errorMessage}` }
		}
	}
}

// Singleton instance
export const voiceTranscriptionService = new VoiceTranscriptionService()
