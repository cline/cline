import React from "react"
import { ClineMessage } from "@shared/ExtensionMessage"
import { COLOR_WHITE, COLOR_GRAY, COLOR_DARK_GRAY, COLOR_BEIGE, COLOR_BLUE, COLOR_RED, COLOR_PURPLE, COLOR_GREEN } from "./colors"
import { Tooltip } from "@heroui/react"

// Color mapping for different message types

interface TaskTimelineTooltipProps {
	message: ClineMessage
	children: React.ReactNode
}

const TaskTimelineTooltip = ({ message, children }: TaskTimelineTooltipProps) => {
	const getMessageDescription = (message: ClineMessage): string => {
		if (message.type === "say") {
			switch (message.say) {
				// TODO: Need to confirm these classifcations with design
				case "task":
					return "Task Message"
				case "user_feedback":
					return "User Message"
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
							} else if (toolData.tool === "webFetch") {
								return `Web Fetch: ${toolData.path || "Unknown URL"}`
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
				case "checkpoint_created":
					return "Checkpoint Created"
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
								return `File Read Approval: ${toolData.tool}`
							} else if (toolData.tool === "editedExistingFile") {
								return `File Edit Approval: ${toolData.path || "Unknown file"}`
							} else if (toolData.tool === "newFileCreated") {
								return `New File Approval: ${toolData.path || "Unknown file"}`
							} else if (toolData.tool === "webFetch") {
								return `Web Fetch: ${toolData.path || "Unknown URL"}`
							}
							return `Tool Approval: ${toolData.tool}`
						} catch (e) {
							return "Tool Approval"
						}
					}
					return "Tool Approval"
				case "command":
					return "Terminal Command Approval"
				case "browser_action_launch":
					return "Browser Action Approval"
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
			const messageDate = new Date(message.ts)
			const today = new Date()

			const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
			const messageDateOnly = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate())

			const time = messageDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })

			const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
			const monthName = monthNames[messageDate.getMonth()]

			if (messageDateOnly.getTime() === todayDate.getTime()) {
				return `${time}`
			} else if (messageDate.getFullYear() === today.getFullYear()) {
				return `${monthName} ${messageDate.getDate()} ${time}`
			} else {
				return `${monthName} ${messageDate.getDate()}, ${messageDate.getFullYear()} ${time}`
			}
		}
		return ""
	}

	// Get color for the indicator based on message type
	const getMessageColor = (message: ClineMessage): string => {
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
								return COLOR_PURPLE // Beige for web fetch operations
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
		return COLOR_DARK_GRAY // Default dark gray
	}

	return (
		<Tooltip
			content={
				<div className="flex flex-col">
					<div className="flex flex-wrap items-center font-bold mb-1">
						<div className="mr-4 mb-0.5">
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
						</div>
						{getTimestamp(message) && (
							<span className="font-normal text-tiny" style={{ fontWeight: "normal", fontSize: "10px" }}>
								{getTimestamp(message)}
							</span>
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
								scrollbarWidth: "none",
							}}>
							{getMessageContent(message)}
						</div>
					)}
				</div>
			}
			classNames={{
				base: "bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border-[var(--vscode-widget-border)] py-1 rounded-[3px] max-w-[calc(100dvw-2rem)] text-xs",
			}}
			shadow="sm"
			placement="bottom"
			disableAnimation
			closeDelay={100}
			isKeyboardDismissDisabled={true}>
			{children}
		</Tooltip>
	)
}

export default TaskTimelineTooltip
