import React, { useState, useEffect } from "react"
import styled from "styled-components"
import { vscode } from "../../utils/vscode"
import { TaskFeedbackType } from "../../../../src/shared/WebviewMessage"

interface TaskFeedbackButtonsProps {
	messageTs: number
	isFromHistory?: boolean // New prop to indicate if this is from history
}

const TaskFeedbackButtons: React.FC<TaskFeedbackButtonsProps> = ({ messageTs, isFromHistory = false }) => {
	const [feedback, setFeedback] = useState<TaskFeedbackType | null>(null)
	const [isAnimating, setIsAnimating] = useState(false)
	const [shouldShow, setShouldShow] = useState<boolean>(true)

	// Check localStorage on mount to see if feedback was already given for this message
	useEffect(() => {
		try {
			const feedbackHistory = localStorage.getItem("taskFeedbackHistory") || "{}"
			const history = JSON.parse(feedbackHistory)
			// Check if this specific message timestamp has received feedback
			if (history[messageTs]) {
				setShouldShow(false)
			}
		} catch (e) {
			console.error("Error checking feedback history:", e)
		}
	}, [messageTs])

	// Don't show buttons if this is from history or feedback was already given
	if (isFromHistory || !shouldShow) {
		return null
	}

	const handleFeedback = (type: TaskFeedbackType) => {
		if (feedback !== null) return // Already provided feedback

		setFeedback(type)
		setIsAnimating(true)

		// Send feedback to extension
		vscode.postMessage({
			type: "taskFeedback",
			feedbackType: type,
		})

		// Store in localStorage that feedback was provided for this message
		try {
			const feedbackHistory = localStorage.getItem("taskFeedbackHistory") || "{}"
			const history = JSON.parse(feedbackHistory)
			history[messageTs] = true
			localStorage.setItem("taskFeedbackHistory", JSON.stringify(history))
		} catch (e) {
			console.error("Error updating feedback history:", e)
		}

		// Reset animation after a delay
		setTimeout(() => {
			setIsAnimating(false)
		}, 1000)
	}

	return (
		<Container>
			<FeedbackText>Did I successfully complete your task?</FeedbackText>
			<ButtonsContainer>
				<FeedbackButton
					onClick={() => handleFeedback("thumbs_up")}
					disabled={feedback !== null}
					selected={feedback === "thumbs_up"}
					animate={isAnimating && feedback === "thumbs_up"}
					title="Yes, this was helpful">
					<span className="codicon codicon-thumbsup" />
				</FeedbackButton>
				<FeedbackButton
					onClick={() => handleFeedback("thumbs_down")}
					disabled={feedback !== null && feedback !== "thumbs_down"}
					selected={feedback === "thumbs_down"}
					animate={isAnimating && feedback === "thumbs_down"}
					title="No, this wasn't helpful">
					<span className="codicon codicon-thumbsdown" />
				</FeedbackButton>
			</ButtonsContainer>
		</Container>
	)
}

const Container = styled.div`
	display: flex;
	align-items: center;
	margin-top: 20px;
	gap: 8px;
`

const FeedbackText = styled.span`
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const ButtonsContainer = styled.div`
	display: flex;
	gap: 8px;
`

interface FeedbackButtonProps {
	selected: boolean
	animate: boolean
}

const FeedbackButton = styled.button<FeedbackButtonProps>`
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 4px;
	background-color: ${(props) => (props.selected ? "var(--vscode-button-background)" : "transparent")};
	color: ${(props) => (props.selected ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)")};
	border: 1px solid ${(props) => (props.selected ? "var(--vscode-button-background)" : "var(--vscode-button-border)")};
	cursor: ${(props) => (props.disabled ? "default" : "pointer")};
	opacity: ${(props) => (props.disabled && !props.selected ? "0.5" : "1")};
	transition: all 0.2s ease;
	transform: ${(props) => (props.animate ? "scale(1.2)" : "scale(1)")};

	&:hover:not(:disabled) {
		background-color: ${(props) =>
			props.selected ? "var(--vscode-button-hoverBackground)" : "var(--vscode-toolbar-hoverBackground)"};
	}

	&:focus {
		outline: none;
		border-color: var(--vscode-focusBorder);
	}

	.codicon {
		font-size: 16px;
	}
`

export default TaskFeedbackButtons
