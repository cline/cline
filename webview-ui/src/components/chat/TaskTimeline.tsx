import React, { useMemo, useState, useRef, useEffect } from "react"
import { ClineMessage } from "@shared/ExtensionMessage"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import TaskTimelineTooltip from "./TaskTimelineTooltip"

interface TaskTimelineProps {
	messages: ClineMessage[]
}

const getBlockColor = (message: ClineMessage): string => {
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

const TaskTimeline: React.FC<TaskTimelineProps> = ({ messages }) => {
	const [hoveredMessage, setHoveredMessage] = useState<ClineMessage | null>(null)
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollableRef = useRef<HTMLDivElement>(null)

	const taskTimelinePropsMessages = useMemo(() => {
		if (messages.length <= 1) return []

		const processed = combineApiRequests(combineCommandSequences(messages.slice(1)))

		return processed.filter((msg) => {
			if (
				msg.type === "say" &&
				(msg.say === "api_req_started" ||
					msg.say === "api_req_finished" ||
					msg.say === "api_req_retried" ||
					msg.say === "deleted_api_reqs" ||
					(msg.say === "text" && (!msg.text || msg.text.trim() === "")))
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

	const TOOLTIP_MARGIN = 32 // 32px margin on each side

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
					height: "10px",
					overflowX: "auto",
					scrollbarWidth: "none",
					msOverflowStyle: "none",
					width: "100%",
					WebkitOverflowScrolling: "touch",
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
							width: "5px",
							height: "100%",
							backgroundColor: getBlockColor(message),
							marginRight: "1px",
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
