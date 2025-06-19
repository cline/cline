import { Controller } from ".."
import { StartRecordingRequest, StartRecordingResponse } from "@shared/proto/voice"
import { audioRecordingService } from "@services/audio/AudioRecordingService"
import { VoiceMethodHandler } from "./index"
import * as vscode from "vscode"

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @param request StartRecordingRequest
 * @returns StartRecordingResponse with success status
 */
export const startRecording: VoiceMethodHandler = async (
	controller: Controller,
	request: StartRecordingRequest,
): Promise<StartRecordingResponse> => {
	try {
		const result = await audioRecordingService.startRecording()

		return StartRecordingResponse.create({
			success: result.success,
			error: result.error || "",
		})
	} catch (error) {
		console.error("Error starting recording:", error)
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
		vscode.window.showErrorMessage(`Voice recording error: ${errorMessage}`)
		return StartRecordingResponse.create({
			success: false,
			error: errorMessage,
		})
	}
}
