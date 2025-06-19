import { ClineMessage } from "@shared/ExtensionMessage"
import { COLOR_WHITE, COLOR_GRAY, COLOR_DARK_GRAY, COLOR_BEIGE, COLOR_BLUE, COLOR_PURPLE, COLOR_GREEN } from "../colors"

/**
 *
 * Get the color for a block or the indicator based on the message type
 *
 * @param message ClineMessage - The message to determine the color for
 * @returns string - The color code for the block or indicator
 */
export const getColor = (message: ClineMessage): string => {
	if (message.type === "say") {
		switch (message.say) {
			case "task":
				return COLOR_WHITE // White for system prompt
			case "user_feedback":
				return COLOR_WHITE // White for user feedback
			case "text":
				return COLOR_GRAY // Gray for assistant responses
			case "tool":
				if (message.text) {
					try {
						const toolData = JSON.parse(message.text)
						if (
							toolData.tool === "readFile" ||
							toolData.tool === "listFilesTopLevel" ||
							toolData.tool === "listFilesRecursive" ||
							toolData.tool === "listCodeDefinitionNames" ||
							toolData.tool === "searchFiles"
						) {
							return COLOR_BEIGE // Beige for file read operations
						} else if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") {
							return COLOR_BLUE // Blue for file edit/create operations
						} else if (toolData.tool === "webFetch") {
							return COLOR_PURPLE // Purple for web fetch operations
						}
					} catch (e) {
						// JSON parse error here
					}
				}
				return COLOR_BEIGE // Default beige for tool use
			case "command":
			case "command_output":
				return COLOR_PURPLE // Red for terminal commands
			case "browser_action":
			case "browser_action_result":
				return COLOR_PURPLE // Purple for browser actions
			case "completion_result":
				return COLOR_GREEN // Green for task success
			default:
				return COLOR_DARK_GRAY // Dark gray for unknown
		}
	} else if (message.type === "ask") {
		switch (message.ask) {
			case "followup":
				return COLOR_GRAY // Gray for user messages
			case "plan_mode_respond":
				return COLOR_GRAY // Gray for planning responses
			case "tool":
				// Match the color of the tool approval with the tool type
				if (message.text) {
					try {
						const toolData = JSON.parse(message.text)
						if (
							toolData.tool === "readFile" ||
							toolData.tool === "listFilesTopLevel" ||
							toolData.tool === "listFilesRecursive" ||
							toolData.tool === "listCodeDefinitionNames" ||
							toolData.tool === "searchFiles"
						) {
							return COLOR_BEIGE // Beige for file read operations
						} else if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") {
							return COLOR_BLUE // Blue for file edit/create operations
						} else if (toolData.tool === "webFetch") {
							return COLOR_PURPLE // Purple for web fetch operations
						}
					} catch (e) {
						// JSON parse error here
					}
				}
				return COLOR_BEIGE // Default beige for tool approvals
			case "command":
				return COLOR_PURPLE // Red for command approvals (same as terminal commands)
			case "browser_action_launch":
				return COLOR_PURPLE // Purple for browser launch approvals (same as browser actions)
			default:
				return COLOR_DARK_GRAY // Dark gray for unknown
		}
	}
	return COLOR_WHITE // Default color
}
