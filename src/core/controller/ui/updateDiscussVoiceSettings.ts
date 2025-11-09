import { Empty } from "../../../shared/proto/cline/common"
import type { DiscussVoiceSettingsRequest } from "../../../shared/proto/cline/ui"
import type { Controller } from ".."

/**
 * Update discuss mode voice settings
 * @param controller The controller instance
 * @param request The settings to update
 * @returns Empty response
 */
export async function updateDiscussVoiceSettings(controller: Controller, request: DiscussVoiceSettingsRequest): Promise<Empty> {
	try {
		// Update settings in global state
		if (request.selectedVoice !== undefined) {
			controller.stateManager.setGlobalState("discussModeSelectedVoice", request.selectedVoice)
		}

		if (request.speechSpeed !== undefined) {
			controller.stateManager.setGlobalState("discussModeSpeechSpeed", request.speechSpeed)
		}

		if (request.autoSpeak !== undefined) {
			controller.stateManager.setGlobalState("discussModeAutoSpeak", request.autoSpeak)
		}

		if (request.autoListen !== undefined) {
			controller.stateManager.setGlobalState("discussModeAutoListen", request.autoListen)
		}

		// Notify webview of state change
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error("Failed to update discuss voice settings:", error)
		return Empty.create()
	}
}

// Export with PascalCase for proto compatibility
export { updateDiscussVoiceSettings as UpdateDiscussVoiceSettings }
