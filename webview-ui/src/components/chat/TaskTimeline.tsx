import React, { useMemo, useRef, useEffect, useCallback } from "react"
import { Virtuoso } from "react-virtuoso"
import { ClineMessage } from "@shared/ExtensionMessage"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import TaskTimelineTooltip from "./TaskTimelineTooltip"
import { COLOR_WHITE, COLOR_GRAY, COLOR_DARK_GRAY, COLOR_BEIGE, COLOR_BLUE, COLOR_RED, COLOR_PURPLE, COLOR_GREEN } from "./colors"

// Timeline dimensions and spacing
const TIMELINE_HEIGHT = "18px"
const BLOCK_WIDTH = "9px"
const BLOCK_GAP = "3px"

export interface EnrichedClineMessage extends ClineMessage {
	_blockColor: string
	_tooltipDesc: string
	_tooltipContentPreview: string
	_tooltipTimestamp: string
}

interface TaskTimelineProps {
	messages: ClineMessage[]
}

// Helper functions for enriching messages (logic adapted from TaskTimelineTooltip.tsx)
const getEnrichedMessageDescription = (message: ClineMessage): string => {
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
							toolData.tool === "readFile" ||
							toolData.tool === "listFilesTopLevel" ||
							toolData.tool === "listFilesRecursive" ||
							toolData.tool === "listCodeDefinitionNames" ||
							toolData.tool === "searchFiles"
						)
							return `File Read: ${toolData.tool}`
						if (toolData.tool === "editedExistingFile") return `File Edit: ${toolData.path || "Unknown file"}`
						if (toolData.tool === "newFileCreated") return `New File: ${toolData.path || "Unknown file"}`
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
						)
							return `File Read Approval: ${toolData.tool}`
						if (toolData.tool === "editedExistingFile")
							return `File Edit Approval: ${toolData.path || "Unknown file"}`
						if (toolData.tool === "newFileCreated") return `New File Approval: ${toolData.path || "Unknown file"}`
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

const getEnrichedMessageContent = (message: ClineMessage): string => {
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
		if (message.text.length > 200) return message.text.substring(0, 200) + "..."
		return message.text
	}
	return ""
}

const getEnrichedMessageTimestamp = (message: ClineMessage): string => {
	if (message.ts) {
		const messageDate = new Date(message.ts)
		const today = new Date()
		const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
		const messageDateOnly = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate())
		const time = messageDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
		const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
		const monthName = monthNames[messageDate.getMonth()]
		if (messageDateOnly.getTime() === todayDate.getTime()) return `${time}`
		if (messageDate.getFullYear() === today.getFullYear()) return `${monthName} ${messageDate.getDate()} ${time}`
		return `${monthName} ${messageDate.getDate()}, ${messageDate.getFullYear()} ${time}`
	}
	return ""
}

const getEnrichedBlockColor = (message: ClineMessage): string => {
	if (message.type === "say") {
		switch (message.say) {
			case "task":
				return COLOR_WHITE
			case "user_feedback":
				return COLOR_WHITE
			case "text":
				return COLOR_GRAY
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
						)
							return COLOR_BEIGE
						if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") return COLOR_BLUE
					} catch (e) {
						/* ignore */
					}
				}
				return COLOR_BEIGE
			case "command":
			case "command_output":
				return COLOR_PURPLE
			case "browser_action":
			case "browser_action_result":
				return COLOR_PURPLE
			case "completion_result":
				return COLOR_GREEN
			default:
				return COLOR_DARK_GRAY
		}
	} else if (message.type === "ask") {
		switch (message.ask) {
			case "followup":
				return COLOR_GRAY
			case "plan_mode_respond":
				return COLOR_GRAY
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
						)
							return COLOR_BEIGE
						if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") return COLOR_BLUE
					} catch (e) {
						/* ignore */
					}
				}
				return COLOR_BEIGE
			case "command":
				return COLOR_PURPLE
			case "browser_action_launch":
				return COLOR_PURPLE
			default:
				return COLOR_DARK_GRAY
		}
	}
	return COLOR_WHITE
}

const TaskTimeline: React.FC<TaskTimelineProps> = ({ messages }) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const virtuosoRef = useRef<any>(null)

	const enrichedTimelineMessages: EnrichedClineMessage[] = useMemo(() => {
		if (messages.length <= 1) return []

		const processedAndFiltered = combineApiRequests(combineCommandSequences(messages.slice(1)))
			.filter((msg) => {
				if (
					msg.type === "say" &&
					(msg.say === "api_req_started" ||
						msg.say === "api_req_finished" ||
						msg.say === "api_req_retried" ||
						msg.say === "deleted_api_reqs" ||
						msg.say === "checkpoint_created" ||
						(msg.say === "text" && (!msg.text || msg.text.trim() === "")))
				) {
					return false
				}
				if (
					msg.type === "ask" &&
					(msg.ask === "resume_task" || msg.ask === "resume_completed_task" || msg.ask === "completion_result")
				) {
					return false
				}
				return true
			})
			.map((msg) => ({
				...msg,
				_blockColor: getEnrichedBlockColor(msg),
				_tooltipDesc: getEnrichedMessageDescription(msg),
				_tooltipContentPreview: getEnrichedMessageContent(msg),
				_tooltipTimestamp: getEnrichedMessageTimestamp(msg),
			}))
		return processedAndFiltered
	}, [messages])

	const TimelineBlock = useCallback(
		(index: number) => {
			const message = enrichedTimelineMessages[index]
			return (
				<TaskTimelineTooltip
					message={message} // Pass original message for now, will update tooltip to use enriched props
					blockColor={message._blockColor}
					tooltipDesc={message._tooltipDesc}
					tooltipContentPreview={message._tooltipContentPreview}
					tooltipTimestamp={message._tooltipTimestamp}>
					<div
						style={{
							width: BLOCK_WIDTH,
							height: "100%",
							backgroundColor: message._blockColor, // Use pre-computed color
							flexShrink: 0,
							cursor: "pointer",
							marginRight: BLOCK_GAP,
						}}
					/>
				</TaskTimelineTooltip>
			)
		},
		[enrichedTimelineMessages],
	)

	useEffect(() => {
		if (virtuosoRef.current && enrichedTimelineMessages.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: enrichedTimelineMessages.length - 1,
				align: "end",
			})
		}
	}, [enrichedTimelineMessages])

	if (enrichedTimelineMessages.length === 0) {
		return null
	}

	return (
		<div
			ref={containerRef}
			style={{
				position: "relative",
				width: "100%",
				marginTop: "4px",
				marginBottom: "4px",
				overflow: "hidden",
			}}>
			<style>
				{`
					/* Hide scrollbar for Chrome, Safari and Opera */
					.timeline-virtuoso::-webkit-scrollbar {
						display: none;
					}
					.timeline-virtuoso {
						scrollbar-width: none;
						-ms-overflow-style: none;
					}
				`}
			</style>

			<Virtuoso
				ref={virtuosoRef}
				className="timeline-virtuoso"
				style={{
					height: TIMELINE_HEIGHT,
					width: "100%",
				}}
				totalCount={enrichedTimelineMessages.length}
				itemContent={TimelineBlock}
				horizontalDirection={true}
				increaseViewportBy={12}
				// No fixedItemHeight/Width needed as Virtuoso will use the rendered item's dimensions
			/>
		</div>
	)
}

export default TaskTimeline
