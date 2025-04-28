import React from "react"
import styled from "styled-components"
import { ClineMessage } from "@shared/ExtensionMessage"

interface TimelineHoverModalProps {
	message: ClineMessage
	position: { x: number; y: number }
	onClose: () => void
	isFirstMessage?: boolean
}

const ModalContainer = styled.div<{ x: number; y: number; arrowOffset: number }>`
	position: fixed;
	top: ${(props) => props.y}px;
	left: ${(props) => props.x}px;
	transform: translate(0, -100%);
	background-color: var(--vscode-editor-background);
	color: var(--vscode-foreground);
	padding: 12px 16px;
	border-radius: 6px;
	font-size: 13px;
	white-space: pre-wrap;
	z-index: 1000;
	border: 1px solid var(--vscode-editorGroup-border);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	max-width: 500px;
	max-height: 300px;
	overflow-y: auto;
	overflow-x: hidden;

	/* Add a pointer/arrow at the bottom */
	&::after {
		content: "";
		position: absolute;
		bottom: -10px;
		left: ${(props) => props.arrowOffset}px;
		transform: translateX(-50%);
		border-width: 10px 10px 0;
		border-style: solid;
		border-color: var(--vscode-editor-background) transparent transparent;
		filter: drop-shadow(0 1px 0 var(--vscode-editorGroup-border));
	}

	&::-webkit-scrollbar {
		width: 6px;
	}

	&::-webkit-scrollbar-track {
		background: transparent;
	}

	&::-webkit-scrollbar-thumb {
		background-color: var(--vscode-scrollbarSlider-background);
		border-radius: 3px;
	}
`

const ModalHeader = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 10px;
	padding-bottom: 10px;
	border-bottom: 1px solid var(--vscode-editorGroup-border);
`

const ModalTitle = styled.div`
	font-weight: bold;
	color: var(--vscode-foreground);
	font-size: 14px;
`

const ModalTimestamp = styled.div`
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
`

const ModalContent = styled.div`
	color: var(--vscode-foreground);
	line-height: 1.5;
	margin-bottom: 5px;
`

const ModalFooter = styled.div`
	display: flex;
	justify-content: flex-end;
	margin-top: 10px;
	padding-top: 10px;
	border-top: 1px solid var(--vscode-editorGroup-border);
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
`

// Format timestamp as relative time (e.g., "2m ago", "just now") or time (e.g., "12:13 PM")
const formatRelativeTime = (timestamp: number): string => {
	const now = Date.now()
	const diff = now - timestamp

	// Less than a minute ago
	if (diff < 60 * 1000) {
		return "just now"
	}

	// Less than an hour ago
	if (diff < 60 * 60 * 1000) {
		const minutes = Math.floor(diff / (60 * 1000))
		return `${minutes}m ago`
	}

	// Less than a day ago
	if (diff < 24 * 60 * 60 * 1000) {
		const hours = Math.floor(diff / (60 * 60 * 1000))
		return `${hours}h ago`
	}

	// Format as time for today or date for older
	const date = new Date(timestamp)
	const timeFormatter = new Intl.DateTimeFormat("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	})

	return timeFormatter.format(date)
}

const getModalTitle = (message: ClineMessage): string => {
	if (message.type === "say" && message.say) {
		switch (message.say) {
			case "checkpoint_created":
				return "Checkpoint"
			case "task":
				return "Task Started"
			case "completion_result":
				return "Task Completed"
			case "user_feedback":
				return "User Message"
			case "text":
				return "Message"
			default:
				return `${message.say.charAt(0).toUpperCase() + message.say.slice(1).replace(/_/g, " ")}`
		}
	}

	if (message.type === "ask" && message.ask) {
		switch (message.ask) {
			case "followup":
				return "Follow-up Question"
			case "tool":
				return "Tool Usage"
			case "completion_result":
				return "Task Completed"
			default:
				return `${message.ask.charAt(0).toUpperCase() + message.ask.slice(1).replace(/_/g, " ")}`
		}
	}

	return "Timeline Event"
}

const getModalContent = (message: ClineMessage): string => {
	if (message.text) {
		return message.text
	}

	if (message.type === "say" && message.say) {
		switch (message.say) {
			case "checkpoint_created":
				return "A checkpoint was created to save the current state of your project."
			case "task":
				return "A new task was started."
			case "completion_result":
				return "The task was completed successfully."
			default:
				return `Event: ${message.say}`
		}
	}

	if (message.type === "ask" && message.ask) {
		switch (message.ask) {
			case "followup":
				return "A follow-up question was asked."
			case "tool":
				return "A tool was used to perform an action."
			case "completion_result":
				return "The task was completed successfully."
			default:
				return `Action: ${message.ask}`
		}
	}

	return "Timeline event"
}

const getMessageType = (message: ClineMessage, isFirstMessage?: boolean): string => {
	// If this is the first message in the timeline, treat it as user_feedback
	if (isFirstMessage) {
		return `Say: user_feedback`
	}

	if (message.type === "say") {
		return `Say: ${message.say || "unknown"}`
	} else if (message.type === "ask") {
		return `Ask: ${message.ask || "unknown"}`
	}
	return "Unknown message type"
}

const TimelineHoverModal: React.FC<TimelineHoverModalProps> = ({ message, position, onClose, isFirstMessage }) => {
	// Create a ref to detect clicks outside the modal
	const modalRef = React.useRef<HTMLDivElement>(null)

	// Calculate initial position values
	// We'll use a reasonable default width estimate for initial positioning
	const estimatedWidth = 300 // Reasonable default width estimate
	const initialX = Math.max(16, Math.min(position.x - estimatedWidth / 2, window.innerWidth - 16 - estimatedWidth))
	const initialArrowOffset = estimatedWidth / 2 + (position.x - (initialX + estimatedWidth / 2))

	// State for position and arrow offset
	const [modalPosition, setModalPosition] = React.useState({
		x: initialX,
		y: position.y,
		arrowOffset: initialArrowOffset,
	})

	// Handle click outside the modal
	React.useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
				onClose()
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [onClose])

	// Use useLayoutEffect to measure and adjust position once after initial render
	React.useLayoutEffect(() => {
		if (modalRef.current) {
			const rect = modalRef.current.getBoundingClientRect()
			const actualWidth = rect.width

			// Calculate the adjusted position to ensure modal stays within viewport
			let newX = position.x - actualWidth / 2 // Center the modal horizontally
			const newArrowOffset = actualWidth / 2 // Default arrow position (center)
			let adjustedArrowOffset = newArrowOffset

			// Check if modal would extend beyond left edge of viewport
			if (newX < 16) {
				// Add some padding from the edge
				const offset = newX - 16
				newX = 16
				adjustedArrowOffset = newArrowOffset + offset // Adjust arrow position
			}
			// Check if modal would extend beyond right edge of viewport
			else if (newX + actualWidth > window.innerWidth - 16) {
				const maxX = window.innerWidth - 16 - actualWidth
				const offset = newX - maxX
				newX = maxX
				adjustedArrowOffset = newArrowOffset + offset // Adjust arrow position
			}

			// Only update state if the position needs to change from our initial estimate
			if (Math.abs(newX - modalPosition.x) > 5 || Math.abs(adjustedArrowOffset - modalPosition.arrowOffset) > 5) {
				setModalPosition({
					x: newX,
					y: position.y,
					arrowOffset: adjustedArrowOffset,
				})
			}
		}
	}, []) // Empty dependency array means this runs once after initial render

	return (
		<ModalContainer ref={modalRef} x={modalPosition.x} y={modalPosition.y} arrowOffset={modalPosition.arrowOffset}>
			<ModalHeader>
				<ModalTitle>{getModalTitle(message)}</ModalTitle>
				<ModalTimestamp>{formatRelativeTime(message.ts)}</ModalTimestamp>
			</ModalHeader>
			<ModalContent>{getModalContent(message)}</ModalContent>
			<ModalFooter>{getMessageType(message, isFirstMessage)}</ModalFooter>
		</ModalContainer>
	)
}

export default TimelineHoverModal
