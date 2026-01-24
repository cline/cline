import { systemPromptsManager } from "../../prompts/SystemPromptsManager"
import { Logger } from "@/shared/services/Logger"
import * as vscode from "vscode"

export interface OpenPromptsFolderResponse {
	success: boolean
	path: string
	error?: string
}

export async function openPromptsFolder(): Promise<OpenPromptsFolderResponse> {
	try {
		const promptsDir = systemPromptsManager.getPromptsDirectory()
		await systemPromptsManager.ensurePromptsDir()
		await vscode.env.openExternal(vscode.Uri.file(promptsDir))
		return { success: true, path: promptsDir }
	} catch (error) {
		Logger.error("Failed to open prompts folder:", error)
		return { success: false, path: "", error: String(error) }
	}
}
