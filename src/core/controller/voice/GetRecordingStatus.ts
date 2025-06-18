import { Controller } from ".."
import { GetRecordingStatusRequest, GetRecordingStatusResponse } from "@shared/proto/voice"
import { audioRecordingService } from "@services/audio/AudioRecordingService"
import { VoiceMethodHandler } from "./index"

/**
 * Gets the current recording status
 * @param controller The controller instance
 * @param request GetRecordingStatusRequest
 * @returns GetRecordingStatusResponse with current status
 */
export const GetRecordingStatus: VoiceMethodHandler = async (
	controller: Controller,
	request: GetRecordingStatusRequest,
): Promise<GetRecordingStatusResponse> => {
	try {
		const status = audioRecordingService.getRecordingStatus()

		return GetRecordingStatusResponse.create({
			isRecording: status.isRecording,
			durationSeconds: status.durationSeconds,
			error: status.error || "",
		})
	} catch (error) {
		console.error("Error getting recording status:", error)
		return GetRecordingStatusResponse.create({
			isRecording: false,
			durationSeconds: 0,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
