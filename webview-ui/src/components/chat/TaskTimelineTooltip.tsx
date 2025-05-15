import React from "react"
import { ClineMessage } from "@shared/ExtensionMessage"
// COLOR_WHITE, COLOR_GRAY, COLOR_DARK_GRAY, COLOR_BEIGE, COLOR_BLUE, COLOR_RED, COLOR_PURPLE, COLOR_GREEN are now defined in TaskTimeline.tsx or a shared colors.ts file
// For this diff, we assume they are imported if this file were to be standalone, but they will be removed.

interface TaskTimelineTooltipProps {
	message: ClineMessage
	// No 'children' prop as it's no longer a wrapper
	// Add a prop for the pre-calculated color
	blockColor: string
}

const getMessageDescription = (message: ClineMessage): string => {
	if (message.type === "say") {
		switch (message.say) {
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
							[
								"readFile",
								"listFilesTopLevel",
								"listFilesRecursive",
								"listCodeDefinitionNames",
								"searchFiles",
							].includes(toolData.tool)
						)
							return `File Read: ${toolData.tool}`
						if (toolData.tool === "editedExistingFile") return `File Edit: ${toolData.path || "Unknown file"}`
						if (toolData.tool === "newFileCreated") return `New File: ${toolData.path || "Unknown file"}`
						return `Tool: ${toolData.tool}`
					} catch (e) {
						/* fallback */
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
							[
								"readFile",
								"listFilesTopLevel",
								"listFilesRecursive",
								"listCodeDefinitionNames",
								"searchFiles",
							].includes(toolData.tool)
						)
							return `File Read Approval: ${toolData.tool}`
						if (toolData.tool === "editedExistingFile")
							return `File Edit Approval: ${toolData.path || "Unknown file"}`
						if (toolData.tool === "newFileCreated") return `New File Approval: ${toolData.path || "Unknown file"}`
						return `Tool Approval: ${toolData.tool}`
					} catch (e) {
						/* fallback */
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
		if (message.type === "ask" && message.ask === "plan_mode_respond") {
			try {
				const planData = JSON.parse(message.text)
				return planData.response || message.text
			} catch (e) {
				return message.text
			}
		} else if (message.type === "say" && message.say === "tool") {
			try {
				const toolData = JSON.parse(message.text)
				return JSON.stringify(toolData, null, 2)
			} catch (e) {
				return message.text
			}
		}
		return message.text.length > 200 ? message.text.substring(0, 200) + "..." : message.text
	}
	return ""
}

const getTimestamp = (message: ClineMessage): string => {
	if (!message.ts) return ""
	const msgDate = new Date(message.ts)
	const today = new Date()
	const isToday = msgDate.toDateString() === today.toDateString()
	const isThisYear = msgDate.getFullYear() === today.getFullYear()
	const time = msgDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
	if (isToday) return time
	if (isThisYear) return `${msgDate.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`
	return `${msgDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${time}`
}

// getMessageColor is removed from here and will be in TaskTimeline.tsx or a shared utility.

const TaskTimelineTooltip: React.FC<TaskTimelineTooltipProps> = ({ message, blockColor }) => {
	return (
		<div className="flex flex-col bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border border-[var(--vscode-widget-border)] py-1 px-2 rounded-[3px] shadow-md text-xs max-w-xs">
			<div className="flex flex-wrap items-center font-bold mb-1">
				<div className="mr-2 mb-0.5 flex items-center">
					<div
						style={{
							width: "10px",
							height: "10px",
							borderRadius: "50%",
							backgroundColor: blockColor, // Use passed blockColor
							marginRight: "6px",
							display: "inline-block",
							flexShrink: 0,
						}}
					/>
					<span className="truncate max-w-[150px]">{getMessageDescription(message)}</span>
				</div>
				{getTimestamp(message) && (
					<span className="font-normal text-tiny" style={{ fontSize: "10px", marginLeft: "auto" }}>
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
						scrollbarWidth: "thin",
						scrollbarColor: "var(--vscode-scrollbarSlider-background) var(--vscode-editorWidget-background)",
					}}
					className="timeline-tooltip-content">
					{getMessageContent(message)}
				</div>
			)}
		</div>
	)
}

export default React.memo(TaskTimelineTooltip)
