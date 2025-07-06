import { Controller } from ".."
import { StopRecordingRequest, RecordedAudio } from "@shared/proto/voice"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { VoiceMethodHandler } from "./index"

/**
 * Stops audio recording and returns the recorded audio
 * @param controller The controller instance
 * @param request StopRecordingRequest
 * @returns RecordedAudio with audio data
 */
export const stopRecording: VoiceMethodHandler = async (
	controller: Controller,
	_request: StopRecordingRequest,
): Promise<RecordedAudio> => {
	const taskId = controller.task?.taskId
	const recordingStatus = audioRecordingService.getRecordingStatus()
	const recordingDuration = recordingStatus.durationSeconds * 1000 // Convert to milliseconds

	try {
		const result = await audioRecordingService.stopRecording()

		// Capture telemetry for recording stop
		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, result.success, process.platform)

		// Calculate audio size if available

		return RecordedAudio.create({
			success: result.success,
			audioBase64: result.audioBase64 || "",
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error stopping recording:", error)

		// Capture telemetry for recording failure
		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, false, process.platform)

		return RecordedAudio.create({
			success: false,
			audioBase64: "",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
