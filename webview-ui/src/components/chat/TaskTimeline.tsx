import React, { useMemo, useState, useRef, useEffect } from "react"
import { ClineMessage } from "@shared/ExtensionMessage"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import TaskTimelineTooltip from "./TaskTimelineTooltip"
import { COLOR_WHITE, COLOR_GRAY, COLOR_DARK_GRAY, COLOR_BEIGE, COLOR_BLUE, COLOR_RED, COLOR_PURPLE, COLOR_GREEN } from "./colors"

// Timeline dimensions and spacing
const TIMELINE_HEIGHT = "18px"
const BLOCK_WIDTH = "9px"
const BLOCK_GAP = "3px"
const TOOLTIP_MARGIN = 32 // 32px margin on each side

interface TaskTimelineProps {
	messages: ClineMessage[]
}

const getBlockColor = (message: ClineMessage): string => {
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

const TaskTimeline: React.FC<TaskTimelineProps> = ({ messages }) => {
	const [hoveredMessage, setHoveredMessage] = useState<ClineMessage | null>(null)
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollableRef = useRef<HTMLDivElement>(null)

	const taskTimelinePropsMessages = useMemo(() => {
		if (messages.length <= 1) return []

		const processed = combineApiRequests(combineCommandSequences(messages.slice(1)))

		return processed.filter((msg) => {
			// Filter out standard "say" events we don't want to show
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

			// Filter out "ask" events we don't want to show, including the duplicate completion_result
			if (
				msg.type === "ask" &&
				(msg.ask === "resume_task" || msg.ask === "resume_completed_task" || msg.ask === "completion_result") // Filter out the duplicate completion_result "ask" message
			) {
				return false
			}

			return true
		})
	}, [messages])

	useEffect(() => {
		if (scrollableRef.current && taskTimelinePropsMessages.length > 0) {
			scrollableRef.current.scrollLeft = scrollableRef.current.scrollWidth
		}
	}, [taskTimelinePropsMessages])

	if (taskTimelinePropsMessages.length === 0) {
		return null
	}

	const handleMouseEnter = (message: ClineMessage, event: React.MouseEvent<HTMLDivElement>) => {
		setHoveredMessage(message)

		const viewportWidth = window.innerWidth
		const tooltipWidth = viewportWidth - TOOLTIP_MARGIN * 2

		// Center the tooltip horizontally in the viewport
		const x = TOOLTIP_MARGIN

		setTooltipPosition({ x, y: event.clientY })
	}

	const handleMouseLeave = () => {
		setHoveredMessage(null)
		setTooltipPosition(null)
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
			<div
				ref={scrollableRef}
				style={{
					display: "flex",
					height: TIMELINE_HEIGHT,
					overflowX: "auto",
					scrollbarWidth: "none",
					msOverflowStyle: "none",
					width: "100%",
					WebkitOverflowScrolling: "touch",
					gap: BLOCK_GAP, // Using flexbox gap instead of marginRight
				}}>
				<style>
					{`
            /* Hide scrollbar for Chrome, Safari and Opera */
            div::-webkit-scrollbar {
              display: none;
            }
          `}
				</style>
				{taskTimelinePropsMessages.map((message, index) => (
					<div
						key={index}
						style={{
							width: BLOCK_WIDTH,
							height: "100%",
							backgroundColor: getBlockColor(message),
							flexShrink: 0,
							cursor: "pointer",
						}}
						onMouseEnter={(e) => handleMouseEnter(message, e)}
						onMouseLeave={handleMouseLeave}
					/>
				))}
			</div>

			{hoveredMessage && containerRef.current && tooltipPosition && (
				<div
					style={{
						position: "fixed",
						left: `${tooltipPosition.x}px`,
						top: `${tooltipPosition.y + 20}px`,
						zIndex: 1000,
						pointerEvents: "none",
						width: `calc(100% - ${TOOLTIP_MARGIN * 2}px)`,
					}}>
					<TaskTimelineTooltip message={hoveredMessage} />
				</div>
			)}
		</div>
	)
}

export default TaskTimeline
