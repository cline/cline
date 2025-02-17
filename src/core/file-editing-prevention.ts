import { ChatSettings } from "../shared/ChatSettings"
import { formatResponse } from "./prompts/responses"

export interface FileEditingPreventionResult {
	isPreventingEdit: boolean
	toolError?: string
}

export function checkFileEditingPrevention(chatSettings: ChatSettings): FileEditingPreventionResult {
	if (chatSettings.mode === "plan") {
		return {
			isPreventingEdit: true,
			toolError: formatResponse.toolError(
				"File editing is not allowed in Plan mode. Please switch to Act mode to make file changes.",
			),
		}
	}

	return {
		isPreventingEdit: false,
	}
}
