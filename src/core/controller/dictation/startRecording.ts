import { RecordingResult, StartRecordingRequest } from "@shared/proto/cline/dictation"
import { HostProvider } from "@/hosts/host-provider"
import { AuthService } from "@/services/auth/AuthService"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Controller } from ".."

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @param request StartRecordingRequest
 * @returns RecordingResult with success status
 */
export const startRecording = async (controller: Controller, _request: StartRecordingRequest): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId

	try {
		const userInfo = AuthService.getInstance().getInfo()
		if (!userInfo?.user?.uid) {
			throw new Error("User is not authenticated. Please log in first.")
		}

		const result = await audioRecordingService.startRecording()

		// Capture telemetry for recording start
		if (result.success) {
			telemetryService.captureVoiceRecordingStarted(taskId, process.platform)
		}

		return RecordingResult.create({
			success: result.success,
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error starting recording:", error)
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Voice recording error: ${errorMessage}`,
		})
		return RecordingResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
