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
	return (
		<div
			data-testid="send-button"
			title={clineAsk === "resume_task" && !(isStreaming && !didClickCancel) ? "Resume Task" : undefined}
			className={`input-icon-button ${textAreaDisabled && !(isStreaming && !didClickCancel) && !(clineAsk === "resume_task") ? "disabled" : ""} codicon ${
				isStreaming && !didClickCancel ? "codicon-debug-pause" : "codicon-play"
			} ${clineAsk === "resume_task" && !(isStreaming && !didClickCancel) ? "resume-play-button" : ""}`}
			onClick={() => {
				if (isStreaming && !didClickCancel) {
					// Cancel task functionality
					TaskServiceClient.cancelTask({})
					setDidClickCancel?.(true)
				} else if (clineAsk === "resume_task") {
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
				fontSize: clineAsk === "resume_task" && !(isStreaming && !didClickCancel) ? 25 : 22, // Reduced overall size by 3px, but resume state still 3px bigger
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: isStreaming && !didClickCancel ? "pointer" : undefined,
				color: clineAsk === "resume_task" && !(isStreaming && !didClickCancel) ? modeColor : undefined,
				opacity: clineAsk === "resume_task" && !(isStreaming && !didClickCancel) ? 1 : undefined, // Ensure no opacity effect in resume state
				...(clineAsk === "resume_task" && !(isStreaming && !didClickCancel)
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
