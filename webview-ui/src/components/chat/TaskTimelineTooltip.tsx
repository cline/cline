import React from "react"
import { ClineMessage } from "@shared/ExtensionMessage"

// Color mapping for different message types

interface TaskTimelineTooltipProps {
	message: ClineMessage
}

const TaskTimelineTooltip: React.FC<TaskTimelineTooltipProps> = ({ message }) => {
	const getMessageDescription = (message: ClineMessage): string => {
		if (message.type === "say") {
			switch (message.say) {
				// TODO: Need to confirm these classifcations with design
				case "task":
					return "Task Message"
				case "text":
					return "Assistant Response"
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
								return `File Read: ${toolData.tool}`
							} else if (toolData.tool === "editedExistingFile") {
								return `File Edit: ${toolData.path || "Unknown file"}`
							} else if (toolData.tool === "newFileCreated") {
								return `New File: ${toolData.path || "Unknown file"}`
							}
							return `Tool: ${toolData.tool}`
						} catch (e) {
							return "Tool Use"
						}
					}
					return "Tool Use"
				case "command":
					return "Terminal Command"
				case "command_output":
					return "Terminal Output"
				case "browser_action":
					return "Browser Action"
				case "browser_action_result":
					return "Browser Result"
				case "completion_result":
					return "Task Completed"
				default:
					return message.say || "Unknown"
			}
		} else if (message.type === "ask") {
			switch (message.ask) {
				case "followup":
					return "User Message"
				case "plan_mode_respond":
					return "Planning Response"
				case "tool":
					return "Tool Approval"
				case "command":
					return "Command Approval"
				case "browser_action_launch":
					return "Browser Launch"
				default:
					return message.ask || "Unknown"
			}
		}
		return "Unknown Message Type"
	}

	const getMessageContent = (message: ClineMessage): string => {
		if (message.text) {
			if (message.type === "ask" && message.ask === "plan_mode_respond" && message.text) {
				try {
					const planData = JSON.parse(message.text)
					return planData.response || message.text
				} catch (e) {
					return message.text
				}
			} else if (message.type === "say" && message.say === "tool" && message.text) {
				try {
					const toolData = JSON.parse(message.text)
					return JSON.stringify(toolData, null, 2)
				} catch (e) {
					return message.text
				}
			}

			if (message.text.length > 200) {
				return message.text.substring(0, 200) + "..."
			}
			return message.text
		}
		return ""
	}

	const getTimestamp = (message: ClineMessage): string => {
		if (message.ts) {
			const date = new Date(message.ts)
			return date.toLocaleTimeString()
		}
		return ""
	}

	// Get color for the indicator based on message type
	const getMessageColor = (message: ClineMessage): string => {
		if (message.type === "say") {
			switch (message.say) {
				case "task":
					return "#FFFFFF" // White for system prompt
				case "text":
					return "#AAAAAA" // Gray for assistant responses
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
								return "#F5F5DC" // Beige for file read operations
							} else if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") {
								return "#3B82F6" // Blue for file edit/create operations
							}
						} catch (e) {
							// JSON parse error here
						}
					}
					return "#F5F5DC" // Default beige for tool use
				case "command":
				case "command_output":
					return "#EF4444" // Red for terminal commands
				case "browser_action":
				case "browser_action_result":
					return "#8B5CF6" // Purple for browser actions
				case "completion_result":
					return "#10B981" // Green for task success
				default:
					return "#9E9E9E" // Grey for unknown
			}
		} else if (message.type === "ask") {
			switch (message.ask) {
				case "followup":
					return "#AAAAAA" // Gray for user messages
				case "plan_mode_respond":
					return "#AAAAAA" // Gray for planning responses
				case "tool":
					return "#9E9E9E" // Gray for tool approvals
				case "command":
					return "#9E9E9E" // Gray for command approvals
				case "browser_action_launch":
					return "#9E9E9E" // Gray for browser launch approvals
				default:
					return "#9E9E9E" // Grey for unknown
			}
		}
		return "#9E9E9E" // Default grey
	}

	return (
		<div
			style={{
				backgroundColor: "var(--vscode-editor-background)",
				color: "var(--vscode-editor-foreground)",
				border: "1px solid var(--vscode-widget-border)",
				borderRadius: "3px",
				padding: "8px",
				width: "100%", // Fill the container width
				boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
				fontSize: "12px",
			}}>
			<div style={{ fontWeight: "bold", marginBottom: "4px", display: "flex", alignItems: "center" }}>
				<div
					style={{
						width: "10px",
						height: "10px",
						minWidth: "10px", // Ensure fixed width
						minHeight: "10px", // Ensure fixed height
						borderRadius: "50%",
						backgroundColor: getMessageColor(message),
						marginRight: "8px",
						display: "inline-block",
						flexShrink: 0, // Prevent shrinking when space is limited
					}}
				/>
				{getMessageDescription(message)}
				{getTimestamp(message) && (
					<span style={{ fontWeight: "normal", fontSize: "10px", marginLeft: "8px" }}>{getTimestamp(message)}</span>
				)}
			</div>
			{getMessageContent(message) && (
				<div
					style={{
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						maxHeight: "150px",
						overflowY: "auto",
						fontSize: "11px",
						fontFamily: "var(--vscode-editor-font-family)",
						backgroundColor: "var(--vscode-textBlockQuote-background)",
						padding: "4px",
						borderRadius: "2px",
					}}>
					{getMessageContent(message)}
				</div>
			)}
		</div>
	)
}

export default TaskTimelineTooltip
