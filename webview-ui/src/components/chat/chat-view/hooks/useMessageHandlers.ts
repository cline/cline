import type { ClineMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/cline/task"
import { useCallback } from "react"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ClineMessage[], chatState: ChatState): MessageHandlers {
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		clineAsk,
		lastMessage,
	} = chatState

	// Handle sending a message
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// Prepend the active quote if it exists
			if (activeQuote && hasContent) {
				const prefix = "[context] \n> "
				const formattedQuote = activeQuote
				const suffix = "\n[/context] \n\n"
				messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				if (messages.length === 0) {
					await TaskServiceClient.newTask(NewTaskRequest.create({ text: messageToSend, images, files }))
				} else if (clineAsk) {
					switch (clineAsk) {
						case "followup":
						case "plan_mode_respond":
						case "tool":
						case "browser_action_launch":
						case "command":
						case "command_output":
						case "use_mcp_server":
						case "completion_result":
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
						case "auto_approval_max_req_reached":
						case "api_req_failed":
						case "new_task":
						case "condense":
						case "report_bug":
							await TaskServiceClient.askResponse(
								AskResponseRequest.create({
									responseType: "messageResponse",
									text: messageToSend,
									images,
									files,
								}),
							)
							break
					}
				}
				setInputValue("")
				setActiveQuote(null)
				setSendingDisabled(true)
				setSelectedImages([])
				setSelectedFiles([])
				setEnableButtons(false)

				// Reset auto-scroll
				if ("disableAutoScrollRef" in chatState) {
					;(chatState as any).disableAutoScrollRef.current = false
				}
			}
		},
		[
			messages.length,
			clineAsk,
			activeQuote,
			setInputValue,
			setActiveQuote,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			setEnableButtons,
			chatState,
		],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote])

	// Clear input state helper
	const clearInputState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Execute button action based on type
	const executeButtonAction = useCallback(
		async (actionType: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			const hasContent = trimmedInput || (images && images.length > 0) || (files && files.length > 0)

			switch (actionType) {
				case "approve":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
						clearInputState()
					}
					break

				case "reject":
					if (hasContent) {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "noButtonClicked",
							}),
						)
					}
					clearInputState()
					break

				case "proceed":
					if (hasContent) {
						await handleSendMessage(trimmedInput || "", images || [], files || [])
					} else {
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
						clearInputState()
					}
					break

				case "new_task":
					if (clineAsk === "new_task") {
						console.info("new task button clicked!", {
							lastMessage,
							messages,
							clineAsk,
							text,
						})
						await TaskServiceClient.newTask(
							NewTaskRequest.create({
								text: lastMessage?.text,
								images: [],
								files: [],
							}),
						)
					} else {
						await startNewTask()
					}
					break

				case "cancel":
					await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					return // Don't disable buttons for cancel

				case "utility":
					switch (clineAsk) {
						case "condense":
							await SlashServiceClient.condense(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
						case "report_bug":
							await SlashServiceClient.reportBug(StringRequest.create({ value: lastMessage?.text })).catch((err) =>
								console.error(err),
							)
							break
					}
					break
			}

			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[clineAsk, lastMessage, messages, clearInputState, handleSendMessage, startNewTask, chatState],
	)

	// Unified button click handler that takes action directly
	const handleButtonClick = useCallback(
		async (action: string, text?: string, images?: string[], files?: string[]) => {
			// Map action strings to ButtonActionType
			let actionType: ButtonActionType

			switch (action) {
				case "Approve":
				case "Save":
				case "Run Command":
				case "Retry":
				case "Switch to Act Mode":
					actionType = "approve"
					break
				case "Reject":
					actionType = "reject"
					break
				case "Proceed":
				case "Proceed Anyways":
				case "Proceed While Running":
				case "Resume Task":
					actionType = "proceed"
					break
				case "Start New Task":
				case "Start New Task with Context":
					actionType = "new_task"
					break
				case "Cancel":
					actionType = "cancel"
					break
				case "Condense Conversation":
				case "Report GitHub issue":
					actionType = "utility"
					break
				default:
					console.warn(`Unknown action: ${action}`)
					return
			}

			await executeButtonAction(actionType, text, images, files)
		},
		[executeButtonAction],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		handleButtonClick,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
