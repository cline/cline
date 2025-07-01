import { useEffect } from "react"
import { useDeepCompareEffect } from "react-use"
import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { ChatState } from "../types/chatTypes"

/**
 * Custom hook for managing button state based on messages
 * Handles button text and enable/disable states based on the current ask type
 */
export function useButtonState(messages: ClineMessage[], chatState: ChatState) {
	const {
		setSendingDisabled,
		setEnableButtons,
		setPrimaryButtonText,
		setSecondaryButtonText,
		setDidClickCancel,
		lastMessage,
		secondLastMessage,
	} = chatState

	// Update button state based on last message
	useDeepCompareEffect(() => {
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							setSendingDisabled(true)
							setEnableButtons(true)
							setPrimaryButtonText("Retry")
							setSecondaryButtonText("Start New Task")
							break
						case "mistake_limit_reached":
							setSendingDisabled(false)
							setEnableButtons(true)
							setPrimaryButtonText("Proceed Anyways")
							setSecondaryButtonText("Start New Task")
							break
						case "auto_approval_max_req_reached":
							setSendingDisabled(true)
							setEnableButtons(true)
							setPrimaryButtonText("Proceed")
							setSecondaryButtonText("Start New Task")
							break
						case "followup":
							setSendingDisabled(isPartial)
							setEnableButtons(false)
							break
						case "plan_mode_respond":
							setSendingDisabled(isPartial)
							setEnableButtons(false)
							break
						case "tool":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "newFileCreated":
									setPrimaryButtonText("Save")
									setSecondaryButtonText("Reject")
									break
								default:
									setPrimaryButtonText("Approve")
									setSecondaryButtonText("Reject")
									break
							}
							break
						case "browser_action_launch":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Approve")
							setSecondaryButtonText("Reject")
							break
						case "command":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Run Command")
							setSecondaryButtonText("Reject")
							break
						case "command_output":
							setSendingDisabled(false)
							setEnableButtons(true)
							setPrimaryButtonText("Proceed While Running")
							setSecondaryButtonText(undefined)
							break
						case "use_mcp_server":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Approve")
							setSecondaryButtonText("Reject")
							break
						case "completion_result":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							setSendingDisabled(false)
							setEnableButtons(true)
							setPrimaryButtonText("Resume Task")
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
						case "resume_completed_task":
							setSendingDisabled(false)
							setEnableButtons(true)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
						case "new_task":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Start New Task with Context")
							setSecondaryButtonText(undefined)
							break
						case "condense":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Condense Conversation")
							setSecondaryButtonText(undefined)
							break
						case "report_bug":
							setSendingDisabled(isPartial)
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Report GitHub issue")
							setSecondaryButtonText(undefined)
							break
					}
					break
				case "say":
					switch (lastMessage.say) {
						case "api_req_started":
							if (secondLastMessage?.ask === "command_output") {
								chatState.setInputValue("")
								setSendingDisabled(true)
								chatState.setSelectedImages([])
								chatState.setSelectedFiles([])
								setEnableButtons(false)
							}
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	// Reset button state when no messages
	useEffect(() => {
		if (messages.length === 0) {
			setSendingDisabled(false)
			setEnableButtons(false)
			setPrimaryButtonText("Approve")
			setSecondaryButtonText("Reject")
		}
	}, [messages.length, setSendingDisabled, setEnableButtons, setPrimaryButtonText, setSecondaryButtonText])
}
