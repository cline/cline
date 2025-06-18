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
export const StartRecording: VoiceMethodHandler = async (
	controller: Controller,
	request: StartRecordingRequest,
): Promise<StartRecordingResponse> => {
	try {
		const result = await audioRecordingService.startRecording()

		// Show VSCode notification if recording software is missing
		if (!result.success && result.error) {
			if (result.error.includes("brew install sox")) {
				vscode.window
					.showErrorMessage("Voice recording requires SoX. Please install it first.", "Install SoX")
					.then((selection) => {
						if (selection === "Install SoX") {
							vscode.env.openExternal(vscode.Uri.parse("https://formulae.brew.sh/formula/sox"))
						}
					})
			} else if (result.error.includes("apt-get install")) {
				vscode.window.showErrorMessage(
					"Voice recording requires ALSA utilities. Please install: sudo apt-get install alsa-utils",
				)
			} else if (result.error.includes("sourceforge.net")) {
				try {
					const url = "https://sourceforge.net/projects/sox/"
					const parsedUrl = new URL(url)
					const allowedHosts = ["sourceforge.net"]
					if (allowedHosts.includes(parsedUrl.host)) {
						vscode.window
							.showErrorMessage("Voice recording requires SoX for Windows.", "Download SoX")
							.then((selection) => {
								if (selection === "Download SoX") {
									vscode.env.openExternal(vscode.Uri.parse(url))
								}
							})
					} else {
						vscode.window.showErrorMessage("Invalid URL host detected for SoX download.")
					}
				} catch (e) {
					vscode.window.showErrorMessage("An error occurred while validating the SoX download URL.")
				}
			} else {
				vscode.window.showErrorMessage(`Voice recording failed: ${result.error}`)
			}
		}

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
