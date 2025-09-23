import { TranscribeAudioRequest, Transcription } from "@shared/proto/cline/dictation"
import { HostProvider } from "@/hosts/host-provider"
import { getVoiceTranscriptionService } from "@/services/dictation/VoiceTranscriptionService"
import { telemetryService } from "@/services/telemetry"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Controller } from ".."

/**
 * Transcribes audio using Cline transcription service
 * @param controller The controller instance
 * @param request TranscribeAudioRequest containing base64 audio data
 * @returns Transcription with transcribed text or error
 */
export const transcribeAudio = async (controller: Controller, request: TranscribeAudioRequest): Promise<Transcription> => {
	const taskId = controller.task?.taskId
	const startTime = Date.now()

	// Capture telemetry for transcription start
	telemetryService.captureVoiceTranscriptionStarted(taskId, request.language ?? "en")

	try {
		// Transcribe the audio
		const result = await getVoiceTranscriptionService().transcribeAudio(request.audioBase64, request.language ?? "en")
		const durationMs = Date.now() - startTime

		if (result.error) {
			let errorType = "api_error"
			if (result.error.includes("Authentication failed")) {
				errorType = "invalid_jwt_token"
			} else if (result.error.includes("Insufficient credits")) {
				errorType = "insufficient_credits"
			} else if (result.error.includes("Invalid audio format")) {
				errorType = "invalid_audio_format"
			} else if (result.error.includes("No internet connection")) {
				errorType = "no_internet"
			} else if (result.error.includes("Cannot connect")) {
				errorType = "connection_error"
			} else if (result.error.includes("Connection timed out")) {
				errorType = "timeout_error"
			} else if (result.error.includes("Network error")) {
				errorType = "network_error"
			}

			telemetryService.captureVoiceTranscriptionError(taskId, errorType, result.error, durationMs)

			// Use the error message directly from the service as it's already user-friendly
			const errorMessage = result.error

			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: errorMessage,
			})
		} else if (result.text) {
			telemetryService.captureVoiceTranscriptionCompleted(taskId, result.text.length, durationMs, request.language ?? "en")
		}

		return Transcription.create({
			text: result.text ?? "",
			error: result.error ?? "",
		})
	} catch (error) {
		console.error("Error transcribing audio:", error)
		const durationMs = Date.now() - startTime
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"

		telemetryService.captureVoiceTranscriptionError(taskId, "unexpected_error", errorMessage, durationMs)

		return Transcription.create({
			text: "",
			error: errorMessage,
		})
	}
}
