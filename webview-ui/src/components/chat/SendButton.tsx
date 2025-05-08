import React from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import "./SendButton.css"

// Color constants for plan/act modes - using exact colors specified by the user
const PLAN_MODE_COLOR = "#955CF1" // Purple color for plan mode
const ACT_MODE_COLOR = "#0dbc79" // Green color for act mode - exact color specified by the user

interface SendButtonProps {
	textAreaDisabled: boolean
	isStreaming?: boolean
	didClickCancel?: boolean
	setDidClickCancel?: (value: boolean) => void
	setIsTextAreaFocused: (value: boolean) => void
	onSend: () => void
	clineAsk?: string
}

export const SendButton: React.FC<SendButtonProps> = ({
	textAreaDisabled,
	isStreaming,
	didClickCancel,
	setDidClickCancel,
	setIsTextAreaFocused,
	onSend,
	clineAsk,
}) => {
	const { chatSettings } = useExtensionState()
	const modeColor = chatSettings.mode === "plan" ? PLAN_MODE_COLOR : ACT_MODE_COLOR
	// Only show resume task styling if we're actually in a resumable state
	// This prevents the resume task button from showing up at the end of a task
	const isResumeTask = clineAsk === "resume_task" && !isStreaming

	return (
		<div
			data-testid="send-button"
			title={isResumeTask ? "Resume Task" : undefined}
			className={`input-icon-button ${textAreaDisabled && !(isStreaming && !didClickCancel) && !isResumeTask ? "disabled" : ""} codicon ${
				isStreaming && !didClickCancel ? "codicon-debug-pause" : "codicon-play"
			} ${isResumeTask ? "resume-play-button" : ""}`}
			onClick={() => {
				if (isStreaming && !didClickCancel) {
					// Cancel task functionality
					TaskServiceClient.cancelTask({})
					setDidClickCancel?.(true)
				} else if (isResumeTask) {
					// Resume task functionality
					// For empty input, directly send yesButtonClicked to resume the task
					if (!document.querySelector("textarea")?.value.trim()) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
						})
						setIsTextAreaFocused(false)
					} else {
						// For user input, use the normal send flow
						setIsTextAreaFocused(false)
						onSend()
					}
				} else if (!textAreaDisabled) {
					// Send message functionality
					setIsTextAreaFocused(false)
					onSend()
				}
			}}
			style={{
				fontSize: isResumeTask ? 25 : 22, // Reduced overall size by 3px, but resume state still 3px bigger
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: isStreaming && !didClickCancel ? "pointer" : undefined,
				color: isResumeTask ? modeColor : undefined,
				opacity: isResumeTask ? 1 : undefined, // Ensure no opacity effect in resume state
				...(isResumeTask
					? {
							backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="${chatSettings.mode === "plan" ? "#955CF1" : "#0dbc79"}" d="M3.5 2.5v11l9-5.5z"/></svg>`)}")`,
							backgroundRepeat: "no-repeat",
							backgroundPosition: "center",
							backgroundSize: "100%",
							color: "transparent", // Hide the original icon
						}
					: {}),
			}}
		/>
	)
}
