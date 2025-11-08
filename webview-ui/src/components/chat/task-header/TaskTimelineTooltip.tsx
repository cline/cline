import { Tooltip } from "@heroui/react"
import { ClineMessage } from "@shared/ExtensionMessage"
import React from "react"
import { useTranslation } from "react-i18next"
import { getColor } from "./util"

interface TaskTimelineTooltipProps {
	message: ClineMessage
	children: React.ReactNode
}

const TaskTimelineTooltip = ({ message, children }: TaskTimelineTooltipProps) => {
	const { t } = useTranslation()
	const getMessageDescription = (message: ClineMessage): string => {
		if (message.type === "say") {
			switch (message.say) {
				// TODO: Need to confirm these classifcations with design
				case "task":
					return t("task_header.task_timeline.task_message")
				case "user_feedback":
					return t("task_header.task_timeline.user_message")
				case "text":
					return t("task_header.task_timeline.assistant_response")
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
								return t("task_header.task_timeline.file_read", { tool: toolData.tool })
							} else if (toolData.tool === "editedExistingFile") {
								return t("task_header.task_timeline.file_edit", {
									path: toolData.path || t("task_header.task_timeline.unknown_file"),
								})
							} else if (toolData.tool === "newFileCreated") {
								return t("task_header.task_timeline.new_file", {
									path: toolData.path || t("task_header.task_timeline.unknown_file"),
								})
							} else if (toolData.tool === "fileDeleted") {
								return t("task_header.task_timeline.delete_file", {
									path: toolData.path || t("task_header.task_timeline.unknown_file"),
								})
							} else if (toolData.tool === "webFetch") {
								return t("task_header.task_timeline.web_fetch", {
									path: toolData.path || t("task_header.task_timeline.unknown_url"),
								})
							}
							return t("task_header.task_timeline.tool", { tool: toolData.tool })
						} catch (_e) {
							return t("task_header.task_timeline.tool_use")
						}
					}
					return t("task_header.task_timeline.tool_use")
				case "command":
					return t("task_header.task_timeline.terminal_command")
				case "command_output":
					return t("task_header.task_timeline.terminal_output")
				case "browser_action":
					return t("task_header.task_timeline.browser_action")
				case "browser_action_result":
					return t("task_header.task_timeline.browser_result")
				case "completion_result":
					return t("task_header.task_timeline.task_completed")
				case "checkpoint_created":
					return t("task_header.task_timeline.checkpoint_created")
				default:
					return message.say || t("task_header.task_timeline.unknown")
			}
		} else if (message.type === "ask") {
			switch (message.ask) {
				case "followup":
					return t("task_header.task_timeline.assistant_message")
				case "plan_mode_respond":
					return t("task_header.task_timeline.planning_response")
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
								return t("task_header.task_timeline.file_read_approval", { tool: toolData.tool })
							} else if (toolData.tool === "editedExistingFile") {
								return t("task_header.task_timeline.file_edit_approval", {
									path: toolData.path || t("task_header.task_timeline.unknown_file"),
								})
							} else if (toolData.tool === "newFileCreated") {
								return t("task_header.task_timeline.new_file_approval", {
									path: toolData.path || t("task_header.task_timeline.unknown_file"),
								})
							} else if (toolData.tool === "fileDeleted") {
								return t("task_header.task_timeline.file_deletion_approval", {
									path: toolData.path || t("task_header.task_timeline.unknown_file"),
								})
							} else if (toolData.tool === "webFetch") {
								return t("task_header.task_timeline.web_fetch", {
									path: toolData.path || t("task_header.task_timeline.unknown_url"),
								})
							}
							return t("task_header.task_timeline.tool_approval", { tool: toolData.tool })
						} catch (_e) {
							return t("task_header.task_timeline.tool_approval")
						}
					}
					return t("task_header.task_timeline.tool_approval")
				case "command":
					return t("task_header.task_timeline.terminal_command_approval")
				case "browser_action_launch":
					return t("task_header.task_timeline.browser_action_approval")
				default:
					return message.ask || t("task_header.task_timeline.unknown")
			}
		}
		return t("task_header.task_timeline.unknown_message_type")
	}

	const getMessageContent = (message: ClineMessage): string => {
		if (message.text) {
			if (message.type === "ask" && message.ask === "plan_mode_respond" && message.text) {
				try {
					const planData = JSON.parse(message.text)
					return planData.response || message.text
				} catch (_e) {
					return message.text
				}
			} else if (message.type === "say" && message.say === "tool" && message.text) {
				try {
					const toolData = JSON.parse(message.text)
					return JSON.stringify(toolData, null, 2)
				} catch (_e) {
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

	return (
		<Tooltip
			classNames={{
				base: "bg-(--vscode-editor-background) text-(--vscode-editor-foreground) border-(--vscode-widget-border) py-1 rounded-[3px] max-w-[calc(100dvw-2rem)] text-xs",
			}}
			closeDelay={100}
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
									borderRadius: 1.5,
									backgroundColor: getColor(message),
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
			disableAnimation
			isKeyboardDismissDisabled={true}
			placement="bottom"
			shadow="sm">
			{children}
		</Tooltip>
	)
}

export default TaskTimelineTooltip
