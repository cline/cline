import { RecordingResult } from "@shared/proto/cline/dictation"
import { HostProvider } from "@/hosts/host-provider"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Controller } from ".."

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @returns RecordingResult with success status
 */
export const startRecording = async (controller: Controller): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId

	try {
		const userInfo = controller.authService.getInfo()
		if (!userInfo?.user?.uid) {
			throw new Error("Please sign in to your Cline Account to use Dictation.")
		}

		const result = await audioRecordingService.startRecording()

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

		const signInAction = "Sign in to Cline"
		const action = await HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Voice recording error: ${errorMessage}`,
			options: { items: [signInAction] },
		})

		if (action.selectedOption === signInAction) {
			await controller.authService.createAuthRequest()
		}

		return RecordingResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
