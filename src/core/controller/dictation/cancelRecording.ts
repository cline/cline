import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { RecordingRequest, RecordingResult } from "@shared/proto/cline/dictation"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { Controller } from ".."

/**
 * Cancels audio recording without saving or transcribing the audio
 * @param controller The controller instance
 * @param request RecordingRequest
 * @returns RecordingResult indicating success or failure
 */
export const cancelRecording = async (controller: Controller, _request: RecordingRequest): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId
	const recordingStatus = audioRecordingService.getRecordingStatus()
	const recordingDuration = recordingStatus.durationSeconds * 1000 // Convert to milliseconds

	try {
		const result = await audioRecordingService.cancelRecording()

		// Capture telemetry for recording cancellation (using stopped event with success=false to indicate cancellation)
		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, false, process.platform)

		return RecordingResult.create({
			success: result.success,
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error canceling recording:", error)

		// Capture telemetry for recording failure
		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, false, process.platform)

		return RecordingResult.create({
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
