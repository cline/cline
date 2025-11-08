import { StringRequest } from "@shared/proto/cline/common"
import { TaskFeedbackType } from "@shared/WebviewMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import styled from "styled-components"
import { TaskServiceClient } from "@/services/grpc-client"

interface TaskFeedbackButtonsProps {
	messageTs: number
	isFromHistory?: boolean
	style?: React.CSSProperties
}

const IconWrapper = styled.span`
	color: var(--vscode-descriptionForeground);
`

const ButtonWrapper = styled.div`
	transform: scale(0.85);
`

const TaskFeedbackButtons: React.FC<TaskFeedbackButtonsProps> = ({ messageTs, isFromHistory = false, style }) => {
	const [feedback, setFeedback] = useState<TaskFeedbackType | null>(null)
	const [shouldShow, setShouldShow] = useState<boolean>(true)
	const { t } = useTranslation()

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

	const handleFeedback = async (type: TaskFeedbackType) => {
		if (feedback !== null) {
			return // Already provided feedback
		}

		setFeedback(type)

		try {
			await TaskServiceClient.taskFeedback(
				StringRequest.create({
					value: type,
				}),
			)

			// Store in localStorage that feedback was provided for this message
			try {
				const feedbackHistory = localStorage.getItem("taskFeedbackHistory") || "{}"
				const history = JSON.parse(feedbackHistory)
				history[messageTs] = true
				localStorage.setItem("taskFeedbackHistory", JSON.stringify(history))
			} catch (e) {
				console.error("Error updating feedback history:", e)
			}
		} catch (error) {
			console.error("Error sending task feedback:", error)
		}
	}

	return (
		<Container style={style}>
			<ButtonsContainer>
				<ButtonWrapper>
					<VSCodeButton
						appearance="icon"
						aria-label={t("task_feedback_buttons.this_was_helpful")}
						disabled={feedback !== null}
						onClick={() => handleFeedback("thumbs_up")}
						title={t("task_feedback_buttons.this_was_helpful")}>
						<IconWrapper>
							<span
								className={`codicon ${feedback === "thumbs_up" ? "codicon-thumbsup-filled" : "codicon-thumbsup"}`}
							/>
						</IconWrapper>
					</VSCodeButton>
				</ButtonWrapper>
				<ButtonWrapper>
					<VSCodeButton
						appearance="icon"
						aria-label={t("task_feedback_buttons.this_wasnt_helpful")}
						disabled={feedback !== null && feedback !== "thumbs_down"}
						onClick={() => handleFeedback("thumbs_down")}
						title={t("task_feedback_buttons.this_wasnt_helpful")}>
						<IconWrapper>
							<span
								className={`codicon ${feedback === "thumbs_down" ? "codicon-thumbsdown-filled" : "codicon-thumbsdown"}`}
							/>
						</IconWrapper>
					</VSCodeButton>
				</ButtonWrapper>
				{/* <VSCodeButtonLink
					href="https://github.com/cline/cline/issues/new?template=bug_report.yml"
					appearance="icon"
					title="Report a bug"
					aria-label="Report a bug">
					<span className="codicon codicon-bug" />
				</VSCodeButtonLink> */}
			</ButtonsContainer>
		</Container>
	)
}

const Container = styled.div`
	display: flex;
	align-items: center;
	justify-content: flex-end;
`

const ButtonsContainer = styled.div`
	display: flex;
	gap: 0px;
	opacity: 0.5;

	&:hover {
		opacity: 1;
	}
`

export default TaskFeedbackButtons
