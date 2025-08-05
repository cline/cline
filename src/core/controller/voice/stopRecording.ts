import { StopRecordingRequest, RecordedAudio } from "@shared/proto/cline/voice"
import { Controller } from ".."

/**
 * Stops audio recording and returns the recorded audio
 * @param controller The controller instance
 * @param request The request to stop recording
 * @returns RecordedAudio with the recorded data or error
 */
export async function stopRecording(controller: Controller, request: StopRecordingRequest): Promise<RecordedAudio> {
	try {
		// TODO: Implement actual audio recording service
		// For now, return a success response with empty audio
		return RecordedAudio.create({
			success: true,
			audioBase64: "",
			error: "",
		})
	} catch (error) {
		console.error("Error stopping recording:", error)
		return RecordedAudio.create({
			success: false,
			audioBase64: "",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
