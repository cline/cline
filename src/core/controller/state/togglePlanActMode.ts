import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { TogglePlanActModeRequest, TogglePlanActModeResponse } from "../../../shared/proto/state"
import {
	convertProtoChatContentToChatContent,
	convertProtoChatSettingsToChatSettings,
} from "@shared/proto-conversions/state/chat-settings-conversion"

/**
 * Toggles between Plan and Act modes
 * @param controller The controller instance
 * @param request The request containing the chat settings and optional chat content
 * @returns An empty response
 */
export async function togglePlanActMode(
	controller: Controller,
	request: TogglePlanActModeRequest,
): Promise<TogglePlanActModeResponse> {
	try {
		if (!request.chatSettings) {
			throw new Error("Chat settings are required")
		}

		const chatSettings = convertProtoChatSettingsToChatSettings(request.chatSettings)
		const chatContent = request.chatContent ? convertProtoChatContentToChatContent(request.chatContent) : undefined

		// Call the existing controller implementation
		const sentMessage = await controller.togglePlanActModeWithChatSettings(chatSettings, chatContent)

		return TogglePlanActModeResponse.create({
			sentMessage: sentMessage,
		})
	} catch (error) {
		console.error("Failed to toggle Plan/Act mode:", error)
		throw error
	}
}
