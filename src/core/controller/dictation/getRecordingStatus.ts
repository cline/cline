import { RecordingStatus } from "@shared/proto/cline/dictation"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"

/**
 * Gets the current recording status
 * @returns RecordingStatus with current status
 */
export const getRecordingStatus = async (): Promise<RecordingStatus> => {
	try {
		const status = audioRecordingService.getRecordingStatus()

		return RecordingStatus.create({
			isRecording: status.isRecording,
			durationSeconds: status.durationSeconds,
			error: status.error ?? "",
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
