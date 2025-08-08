import React, { useMemo, useState, useRef, useEffect, useCallback } from "react"
import { Virtuoso } from "react-virtuoso"
import { ClineMessage } from "@shared/ExtensionMessage"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import TaskTimelineTooltip from "./TaskTimelineTooltip"
import { getColor } from "./util"

// Timeline dimensions and spacing
const TIMELINE_HEIGHT = "18px"
const BLOCK_WIDTH = "9px"
const BLOCK_GAP = "3px"
const TOOLTIP_MARGIN = 32 // 32px margin on each side

interface TaskTimelineProps {
	messages: ClineMessage[]
	onBlockClick?: (messageIndex: number) => void
}

const TaskTimeline: React.FC<TaskTimelineProps> = ({ messages, onBlockClick }) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const scrollableRef = useRef<HTMLDivElement>(null)

	const { taskTimelinePropsMessages, messageIndexMap } = useMemo(() => {
		if (messages.length <= 1) return { taskTimelinePropsMessages: [], messageIndexMap: [] }

		const processed = combineApiRequests(combineCommandSequences(messages.slice(1)))
		const indexMap: number[] = []

		const filtered = processed.filter((msg, processedIndex) => {
			const originalIndex = messages.findIndex((originalMsg, idx) => idx > 0 && originalMsg.ts === msg.ts)

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
			if (originalIndex !== -1) {
				indexMap.push(originalIndex)
			}

			return true
		})
		return { taskTimelinePropsMessages: filtered, messageIndexMap: indexMap }
	}, [messages])

	useEffect(() => {
		if (scrollableRef.current && taskTimelinePropsMessages.length > 0) {
			scrollableRef.current.scrollLeft = scrollableRef.current.scrollWidth
		}
	}, [taskTimelinePropsMessages])

	// Calculate the item size (width of block + gap)
	const itemWidth = parseInt(BLOCK_WIDTH.replace("px", "")) + parseInt(BLOCK_GAP.replace("px", ""))

	// Virtuoso requires a reference to scroll to the end
	const virtuosoRef = useRef<any>(null)

	// Render a timeline block
	const TimelineBlock = useCallback(
		(index: number) => {
			// Show placeholder block when no items exist
			if (taskTimelinePropsMessages.length === 0 || index >= taskTimelinePropsMessages.length) {
				return (
					<div
						style={{
							width: BLOCK_WIDTH,
							height: "100%",
							backgroundColor: "#e5e5e5", // Light gray placeholder
							flexShrink: 0,
							marginRight: BLOCK_GAP,
							opacity: 0.5,
						}}
					/>
				)
			}

			const message = taskTimelinePropsMessages[index]
			const originalMessageIndex = messageIndexMap[index]

			const handleClick = () => {
				if (onBlockClick && originalMessageIndex !== undefined) {
					onBlockClick(originalMessageIndex)
				}
			}

			return (
				<TaskTimelineTooltip message={message}>
					<div
						onClick={handleClick}
						style={{
							width: BLOCK_WIDTH,
							height: "100%",
							backgroundColor: getColor(message),
							flexShrink: 0,
							cursor: "pointer",
							marginRight: BLOCK_GAP,
						}}
					/>
				</TaskTimelineTooltip>
			)
		},
		[taskTimelinePropsMessages, messageIndexMap, onBlockClick],
	)

	// Scroll to the end when messages change
	useEffect(() => {
		if (virtuosoRef.current && taskTimelinePropsMessages.length > 0) {
			virtuosoRef.current.scrollToIndex({
				index: taskTimelinePropsMessages.length - 1,
				align: "end",
			})
		}
	}, [taskTimelinePropsMessages])

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
				totalCount={Math.max(1, taskTimelinePropsMessages.length)}
				itemContent={TimelineBlock}
				horizontalDirection={true}
				increaseViewportBy={12}
				fixedItemHeight={itemWidth}
			/>
		</div>
	)
}

export default TaskTimeline
