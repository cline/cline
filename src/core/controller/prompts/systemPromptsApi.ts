import { systemPromptsManager } from "../../prompts/SystemPromptsManager"
import { Logger } from "@/shared/services/Logger"

/**
 * API handlers for system prompts UI
 */

export async function handleSystemPromptsList() {
	try {
		const prompts = await systemPromptsManager.scanPrompts(true)
		const activePromptId = await systemPromptsManager.getActivePromptId()

		return {
			prompts: prompts.map((p) => ({
				id: p.id,
				filename: p.filename,
				name: p.name,
				description: p.description,
				enabled: p.enabled,
			})),
			activePromptId,
		}
	} catch (error) {
		Logger.error("Failed to list system prompts:", error)
		return { prompts: [], activePromptId: "default" }
	}
}

export async function handleSystemPromptActivate(promptId: string) {
	try {
		await systemPromptsManager.activatePrompt(promptId)
		const activePromptId = await systemPromptsManager.getActivePromptId()
		return { success: true, activePromptId }
	} catch (error) {
		Logger.error("Failed to activate system prompt:", error)
		return { success: false, activePromptId: "default", error: String(error) }
	}
}

export async function handleSystemPromptsDisableAll() {
	try {
		await systemPromptsManager.deactivateAll()
		return { success: true, activePromptId: "default" }
	} catch (error) {
		Logger.error("Failed to disable all system prompts:", error)
		return { success: false, error: String(error) }
	}
}

export async function handleSystemPromptFile(promptId: string) {
	try {
		const prompts = await systemPromptsManager.scanPrompts(true)
		const prompt = prompts.find((p) => p.id === promptId)
		if (prompt) {
			return { content: prompt.content }
		}
		return { content: "" }
	} catch (error) {
		Logger.error("Failed to read system prompt file:", error)
		return { content: "" }
	}
}
