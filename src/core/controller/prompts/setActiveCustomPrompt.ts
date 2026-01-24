import { systemPromptsManager } from "../../prompts/SystemPromptsManager"
import { Logger } from "@/shared/services/Logger"

export interface SetActivePromptResponse {
	success: boolean
	activePromptId: string
	error?: string
}

/**
 * Sets the active custom prompt by ID
 * @param promptId The prompt ID to activate, or "default" to use Cline's default
 */
export async function setActiveCustomPrompt(promptId: string): Promise<SetActivePromptResponse> {
	try {
		await systemPromptsManager.activatePrompt(promptId)
		const activePromptId = await systemPromptsManager.getActivePromptId()
		return { success: true, activePromptId }
	} catch (error) {
		Logger.error("Failed to set active custom prompt:", error)
		return { success: false, activePromptId: "default", error: String(error) }
	}
}
