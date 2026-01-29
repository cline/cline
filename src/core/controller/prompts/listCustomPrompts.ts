import { systemPromptsManager, SystemPrompt } from "../../prompts/SystemPromptsManager"
import { Logger } from "@/shared/services/Logger"

export interface CustomPromptInfo {
	id: string
	filename: string
	name: string
	description?: string
	enabled: boolean
}

export interface ListCustomPromptsResponse {
	prompts: CustomPromptInfo[]
	activePromptId: string
}

export async function listCustomPrompts(): Promise<ListCustomPromptsResponse> {
	try {
		const prompts = await systemPromptsManager.scanPrompts(true)
		const activePromptId = await systemPromptsManager.getActivePromptId()

		return {
			prompts: prompts.map((p: SystemPrompt) => ({
				id: p.id,
				filename: p.filename,
				name: p.name,
				description: p.description,
				enabled: p.enabled,
			})),
			activePromptId,
		}
	} catch (error) {
		Logger.error("Failed to list custom prompts:", error)
		return { prompts: [], activePromptId: "default" }
	}
}
