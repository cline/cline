import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { RecordingResult } from "@shared/proto/cline/dictation"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { Controller } from ".."

/**
 * Cancels audio recording without saving or transcribing the audio
 * @param controller The controller instance
 * @returns RecordingResult indicating success or failure
 */
export const cancelRecording = async (controller: Controller): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId
	const recordingStatus = audioRecordingService.getRecordingStatus()
	const recordingDuration = recordingStatus.durationSeconds * 1000 // Convert to milliseconds

	try {
		const result = await audioRecordingService.cancelRecording()

		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, false, process.platform)

		return RecordingResult.create({
			success: result.success,
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error canceling recording:", error)

		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, false, process.platform)

		return RecordingResult.create({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
