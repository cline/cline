import { Controller } from ".."
import { StartRecordingRequest, RecordingResult } from "@shared/proto/voice"
import { audioRecordingService } from "@/services/dictation/AudioRecordingService"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"
import { VoiceMethodHandler } from "./index"
import * as vscode from "vscode"

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @param request StartRecordingRequest
 * @returns RecordingResult with success status
 */
export const startRecording: VoiceMethodHandler = async (
	controller: Controller,
	_request: StartRecordingRequest,
): Promise<RecordingResult> => {
	const taskId = controller.task?.taskId

	try {
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
		vscode.window.showErrorMessage(`Voice recording error: ${errorMessage}`)
		return RecordingResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
