import { Controller } from ".."
import { StartRecordingRequest, RecordingResult } from "@shared/proto/voice"
import { audioRecordingService } from "@services/audio/AudioRecordingService"
import { VoiceMethodHandler } from "./index"
import * as vscode from "vscode"
import { getSecret } from "@/core/storage/state"

/**
 * Starts audio recording using the Extension Host
 * @param controller The controller instance
 * @param request StartRecordingRequest
 * @returns RecordingResult with success status
 */
export const startRecording: VoiceMethodHandler = async (
	controller: Controller,
	request: StartRecordingRequest,
): Promise<RecordingResult> => {
	try {
		const openAIKey = await getSecret(controller.context, "openAiNativeApiKey")

		if (!openAIKey || openAIKey.length < 2) {
			const errorMessage =
				"Voice transcription requires OpenAI's Whisper model. Please ensure you have a valid OpenAI API key."
			vscode.window.showErrorMessage(errorMessage)

			return RecordingResult.create({
				success: false,
				error: errorMessage,
			})
		}

		const result = await audioRecordingService.startRecording()

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
