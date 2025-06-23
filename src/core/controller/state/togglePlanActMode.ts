import { Controller } from ".."
import { Boolean } from "../../../shared/proto/common"
import { TogglePlanActModeRequest } from "../../../shared/proto/state"
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
export async function togglePlanActMode(controller: Controller, request: TogglePlanActModeRequest): Promise<Boolean> {
	try {
		if (!request.chatSettings) {
			throw new Error("Chat settings are required")
		}

		const chatSettings = convertProtoChatSettingsToChatSettings(request.chatSettings)
		const chatContent = request.chatContent ? convertProtoChatContentToChatContent(request.chatContent) : undefined

		// Call the existing controller implementation
		const sentMessage = await controller.togglePlanActModeWithChatSettings(chatSettings, chatContent)

		return Boolean.create({
			value: sentMessage,
		})
	} catch (error) {
		console.error("Failed to toggle Plan/Act mode:", error)
		throw error
	}
}
