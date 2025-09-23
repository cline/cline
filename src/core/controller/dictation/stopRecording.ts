import { RecordedAudio } from "@shared/proto/cline/dictation"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@/services/telemetry"
import { Controller } from ".."

/**
 * Stops audio recording and returns the recorded audio
 * @param controller The controller instance
 * @returns RecordedAudio with audio data
 */
export const stopRecording = async (controller: Controller): Promise<RecordedAudio> => {
	const taskId = controller.task?.taskId
	const recordingStatus = audioRecordingService.getRecordingStatus()
	const recordingDuration = recordingStatus.durationSeconds * 1000 // Convert to milliseconds

	try {
		const result = await audioRecordingService.stopRecording()

		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, result.success, process.platform)

		return RecordedAudio.create({
			success: result.success,
			audioBase64: result.audioBase64 ?? "",
			error: result.error ?? "",
		})
	} catch (error) {
		console.error("Error stopping recording:", error)

		telemetryService.captureVoiceRecordingStopped(taskId, recordingDuration, false, process.platform)

		return RecordedAudio.create({
			success: false,
			audioBase64: "",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
