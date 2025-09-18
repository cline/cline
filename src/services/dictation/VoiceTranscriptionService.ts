import { Logger } from "@services/logging/Logger"
import axios from "axios"
import { ClineAccountService } from "@/services/account/ClineAccountService"

// Network error matchers using Map for O(1) lookup
const NETWORK_ERROR_MAP = new Map<string, string>([
	["enotfound", "No internet connection. Please check your network and try again."],
	["econnrefused", "Cannot connect to transcription service. Please check your internet connection."],
	["etimedout", "Connection timed out. Please check your internet connection and try again."],
	["econnreset", "Connection timed out. Please check your internet connection and try again."],
	["network error", "Network error. Please check your internet connection."],
])

// HTTP status code error messages using Map for O(1) lookup
const STATUS_ERROR_MAP = new Map<number, string>([
	[401, "Authentication failed. Please reauthenticate your Cline account"],
	[402, "Insufficient credits for transcription service."],
	[500, "Transcription server error. Please try again later."],
])

// Special 400 error patterns that need custom handling
const BAD_REQUEST_ERROR_PATTERNS = [
	{
		patterns: ["insufficient balance", "insufficient credits"],
		message: "Insufficient credits for transcription service.",
	},
	{
		patterns: ["invalid audio", "invalid format"],
		message: "Invalid audio format. Please try recording again.",
	},
]

export class VoiceTranscriptionService {
	private readonly clineAccountService: ClineAccountService

	constructor() {
		this.clineAccountService = ClineAccountService.getInstance()
	}

	/**
	 * Parses transcription errors and returns user-friendly error messages
	 * @param error The error object from the transcription attempt
	 * @returns An object with the error message
	 */
	private parseTranscriptionError(error: unknown): { error: string } {
		// Handle axios errors with proper status code mapping
		if (axios.isAxiosError(error)) {
			const status = error.response?.status
			// Extract error message from server response - check both 'error' and 'message' fields
			const rawMessage = error.response?.data?.error || error.response?.data?.message || error.message
			const lowerMessage = rawMessage.toLowerCase()

			// Check for network errors using the Map (these don't have status codes)
			for (const [keyword, response] of NETWORK_ERROR_MAP) {
				if (lowerMessage.includes(keyword)) {
					return { error: response }
				}
			}

			// Check if we have a simple status code mapping
			if (status && STATUS_ERROR_MAP.has(status)) {
				return { error: STATUS_ERROR_MAP.get(status)! }
			}

			// Handle special 400 errors with pattern matching
			if (status === 400) {
				// Check for specific error patterns
				for (const { patterns, message } of BAD_REQUEST_ERROR_PATTERNS) {
					if (patterns.some((pattern) => lowerMessage.includes(pattern))) {
						return { error: message }
					}
				}

				// Check for limit exceeded messages (preserve original message)
				if (lowerMessage.includes("exceeds") && lowerMessage.includes("limit")) {
					return { error: rawMessage }
				}

				// For other 400 errors, show the server's message if available, otherwise use generic
				return { error: rawMessage || "Invalid audio format or request data." }
			}

			// Default case for unhandled status codes
			return {
				error: "Transcription failed. Please try again later or raise an issue on https://github.com/cline/cline/issues",
			}
		}

		// Handle non-axios errors (general network errors)
		const errorMessage = error instanceof Error ? error.message : String(error)
		const lowerErrorMessage = errorMessage.toLowerCase()

		// Check network errors using the Map
		for (const [keyword, response] of NETWORK_ERROR_MAP) {
			if (lowerErrorMessage.includes(keyword)) {
				return { error: response }
			}
		}

		return { error: `Network error: ${errorMessage}` }
	}

	async transcribeAudio(audioBase64: string, language?: string): Promise<{ text?: string; error?: string }> {
		try {
			Logger.info("Transcribing audio with Cline transcription service...")

			// Check if using organization account for telemetry
			const userInfo = await this.clineAccountService.fetchMe()
			const activeOrg = userInfo?.organizations?.find((org) => org.active)
			const isOrgAccount = !!activeOrg

			const result = await this.clineAccountService.transcribeAudio(audioBase64, language)

			Logger.info("Transcription successful")

			// Capture telemetry with account type - use dynamic import to avoid circular dependency
			const { telemetryService } = await import("@/services/telemetry")
			telemetryService.captureVoiceTranscriptionCompleted(
				undefined, // taskId
				result.text?.length,
				undefined, // duration
				language,
				isOrgAccount,
			)

			return { text: result.text }
		} catch (error) {
			Logger.error("Voice transcription error:", error)
			return this.parseTranscriptionError(error)
		}
	}
}

// Lazily construct the service to avoid circular import initialization issues
let _voiceTranscriptionServiceInstance: VoiceTranscriptionService | null = null
export function getVoiceTranscriptionService(): VoiceTranscriptionService {
	if (!_voiceTranscriptionServiceInstance) {
		_voiceTranscriptionServiceInstance = new VoiceTranscriptionService()
	}
	return _voiceTranscriptionServiceInstance
}
