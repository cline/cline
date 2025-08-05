import { RecordingStatus } from "@shared/proto/cline/voice"
import { GetRecordingStatusRequest } from "@shared/proto/cline/voice"
import { Controller } from ".."

/**
 * Gets the current recording status
 * @param controller The controller instance
 * @param request The request (unused but required for consistency)
 * @returns RecordingStatus with current status
 */
export async function getRecordingStatus(controller: Controller, request: GetRecordingStatusRequest): Promise<RecordingStatus> {
	try {
		// TODO: Implement actual audio recording service
		// For now, return a default status
		return RecordingStatus.create({
			isRecording: false,
			durationSeconds: 0,
			error: "",
		})
	} catch (error) {
		console.error("Error getting recording status:", error)
		return RecordingStatus.create({
			isRecording: false,
			durationSeconds: 0,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
