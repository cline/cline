import { Controller } from ".."
import { StopRecordingRequest, StopRecordingResponse } from "@shared/proto/voice"
import { audioRecordingService } from "@services/audio/AudioRecordingService"
import { VoiceMethodHandler } from "./index"

/**
 * Stops audio recording and returns the recorded audio
 * @param controller The controller instance
 * @param request StopRecordingRequest
 * @returns StopRecordingResponse with audio data
 */
export const StopRecording: VoiceMethodHandler = async (
	controller: Controller,
	request: StopRecordingRequest,
): Promise<StopRecordingResponse> => {
	try {
		const result = await audioRecordingService.stopRecording()

		return StopRecordingResponse.create({
			success: result.success,
			audioBase64: result.audioBase64 || "",
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error stopping recording:", error)
		return StopRecordingResponse.create({
			success: false,
			audioBase64: "",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
