import React, { useMemo, useState, useRef, useEffect, useCallback } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ClineMessage } from "@shared/ExtensionMessage"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import TaskTimelineTooltip from "./TaskTimelineTooltip"
// getBlockColor will be defined in this file now.

// Color constants (moved from TaskTimelineTooltip.tsx or a shared file)
const COLOR_WHITE = "#FFFFFF"
const COLOR_GRAY = "#808080"
const COLOR_DARK_GRAY = "#A9A9A9"
const COLOR_BEIGE = "#F5F5DC"
const COLOR_BLUE = "#ADD8E6"
const COLOR_RED = "#FFC0CB" // Example, adjust as needed
const COLOR_PURPLE = "#E6E6FA" // Example, adjust as needed
const COLOR_GREEN = "#90EE90" // Example, adjust as needed

// Timeline dimensions and spacing
const TIMELINE_HEIGHT = "18px"
const BLOCK_WIDTH = "9px"
const BLOCK_GAP = "3px"
// const TOOLTIP_MARGIN = 32;

interface TaskTimelineProps {
	messages: ClineMessage[]
}

// Moved getBlockColor function here
const getBlockColor = (message: ClineMessage): string => {
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
							[
								"readFile",
								"listFilesTopLevel",
								"listFilesRecursive",
								"listCodeDefinitionNames",
								"searchFiles",
							].includes(toolData.tool)
						)
							return COLOR_BEIGE
						if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") return COLOR_BLUE
					} catch (e) {
						/* fallback */
					}
				}
				return COLOR_BEIGE
			case "command":
			case "command_output":
				return COLOR_RED // Using defined COLOR_RED
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
							[
								"readFile",
								"listFilesTopLevel",
								"listFilesRecursive",
								"listCodeDefinitionNames",
								"searchFiles",
							].includes(toolData.tool)
						)
							return COLOR_BEIGE
						if (toolData.tool === "editedExistingFile" || toolData.tool === "newFileCreated") return COLOR_BLUE
					} catch (e) {
						/* fallback */
					}
				}
				return COLOR_BEIGE
			case "command":
				return COLOR_RED // Using defined COLOR_RED
			case "browser_action_launch":
				return COLOR_PURPLE
			default:
				return COLOR_DARK_GRAY
		}
	}
	return COLOR_WHITE // Default color
}

// Define an interface for messages that include the pre-calculated _blockColor
interface ProcessedClineMessage extends ClineMessage {
	_blockColor: string
}

const TaskTimeline: React.FC<TaskTimelineProps> = ({ messages }) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const virtuosoRef = useRef<VirtuosoHandle>(null)

	const [hoveredMessage, setHoveredMessage] = useState<ProcessedClineMessage | null>(null) // Use ProcessedClineMessage
	const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null)

	const taskTimelinePropsMessages: ProcessedClineMessage[] = useMemo(() => {
		// Ensure type
		if (messages.length <= 1) return []
		const processed = combineApiRequests(combineCommandSequences(messages.slice(1)))
		return processed
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
			.map(
				(msg): ProcessedClineMessage => ({
					// Explicitly type the mapped object
					...msg,
					_blockColor: getBlockColor(msg),
				}),
			)
	}, [messages])

	useEffect(() => {
		if (virtuosoRef.current && taskTimelinePropsMessages.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: taskTimelinePropsMessages.length - 1,
				align: "end",
			})
		}
	}, [taskTimelinePropsMessages])

	const TimelineBlock = useCallback(
		(index: number) => {
			const message = taskTimelinePropsMessages[index]

			const handleMouseEnter = (event: React.MouseEvent<HTMLDivElement>) => {
				setHoveredMessage(message)
				if (containerRef.current) {
					const blockRect = event.currentTarget.getBoundingClientRect()
					const containerRect = containerRef.current.getBoundingClientRect()
					const tooltipHeightEstimate = 60 // Approximate tooltip height
					const gap = 5

					let top = blockRect.top - containerRect.top - tooltipHeightEstimate - gap
					let left = blockRect.left - containerRect.left + blockRect.width / 2

					setTooltipPosition({ top, left })
				}
			}

			const handleMouseLeave = () => {
				setHoveredMessage(null)
			}

			return (
				<div
					style={{
						width: BLOCK_WIDTH,
						height: "100%",
						backgroundColor: message._blockColor, // Use pre-calculated color
						flexShrink: 0,
						cursor: "pointer",
						marginRight: BLOCK_GAP,
					}}
					onMouseEnter={handleMouseEnter}
					onMouseLeave={handleMouseLeave}
				/>
			)
		},
		[taskTimelinePropsMessages],
	)

	if (taskTimelinePropsMessages.length === 0) {
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
					.timeline-virtuoso::-webkit-scrollbar { display: none; }
					.timeline-virtuoso { scrollbar-width: none; -ms-overflow-style: none; }
				`}
			</style>
			<Virtuoso
				ref={virtuosoRef}
				className="timeline-virtuoso"
				style={{
					height: TIMELINE_HEIGHT,
					width: "100%",
				}}
				totalCount={taskTimelinePropsMessages.length}
				itemContent={TimelineBlock}
				horizontalDirection={true}
				increaseViewportBy={12}
				// fixedItemHeight is for vertical lists; for horizontal, Virtuoso uses item width
			/>
			{hoveredMessage && tooltipPosition && (
				<div
					style={{
						position: "absolute",
						top: `${tooltipPosition.top}px`,
						left: `${tooltipPosition.left}px`,
						transform: "translateX(-50%)", // Center the tooltip
						zIndex: 1000,
						pointerEvents: "none",
					}}>
					{/* Pass the pre-calculated _blockColor to TaskTimelineTooltip */}
					<TaskTimelineTooltip message={hoveredMessage} blockColor={hoveredMessage._blockColor} />
				</div>
			)}
		</div>
	)
}

export default React.memo(TaskTimeline)
