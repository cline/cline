import { useCallback } from "react"
import { ClineMessage, ClineAsk } from "@shared/ExtensionMessage"
import { TaskServiceClient, SlashServiceClient } from "@/services/grpc-client"
import { EmptyRequest, StringRequest } from "@shared/proto/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/task"
import { MessageHandlers, ChatState } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ClineMessage[], chatState: ChatState, isStreaming: boolean): MessageHandlers {
	const {
		inputValue,
		setInputValue,
		activeQuote,
		setActiveQuote,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		setSendingDisabled,
		setEnableButtons,
		setDidClickCancel,
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

	// Handle primary button click
	const handlePrimaryButtonClick = useCallback(
		async (text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()
			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
					// For approval buttons, if there's input content, send it as a proper user message
					// If there's no input content, just approve the action
					if (trimmedInput || (images && images.length > 0) || (files && files.length > 0)) {
						// Send as a regular message so it appears in the conversation
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								files: files,
							}),
						)
					} else {
						// No input content, just approve the action
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
						// Clear input state after sending (only when no content was sent as a message)
						setInputValue("")
						setActiveQuote(null)
						setSelectedImages([])
						setSelectedFiles([])
					}
					break
				case "mistake_limit_reached":
				case "auto_approval_max_req_reached":
				case "command_output":
					// For proceed buttons, if there's input content, send it as a proper user message
					// If there's no input content, just proceed with the action
					if (trimmedInput || (images && images.length > 0) || (files && files.length > 0)) {
						// Send as a regular message so it appears in the conversation
						await handleSendMessage(trimmedInput || "", images || [], files || [])
					} else {
						// No input content, just proceed with the action
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
						// Clear input state after sending (only when no content was sent as a message)
						setInputValue("")
						setActiveQuote(null)
						setSelectedImages([])
						setSelectedFiles([])
					}
					break
				case "resume_task":
					// For resume_task, if there's input content, send it as a proper user message
					// If there's no input content, just resume the task
					if (trimmedInput || (images && images.length > 0) || (files && files.length > 0)) {
						// Send as a regular message so it appears in the conversation
						await handleSendMessage(trimmedInput || "", images || [], files || [])
					} else {
						// No input content, just resume the task
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
						// Clear input state after sending (only when no content was sent as a message)
						setInputValue("")
						setActiveQuote(null)
						setSelectedImages([])
						setSelectedFiles([])
					}
					break
				case "completion_result":
				case "resume_completed_task":
					startNewTask()
					break
				case "new_task":
					console.info("new task button clicked!", { lastMessage, messages, clineAsk, text })
					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: lastMessage?.text,
							images: [],
							files: [],
						}),
					)
					break
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
			setSendingDisabled(true)
			setEnableButtons(false)

			// Reset auto-scroll
			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			clineAsk,
			startNewTask,
			lastMessage,
			messages,
			setInputValue,
			setActiveQuote,
			setSelectedImages,
			setSelectedFiles,
			setSendingDisabled,
			setEnableButtons,
			chatState,
			handleSendMessage,
		],
	)

	// Handle secondary button click
	const handleSecondaryButtonClick = useCallback(
		async (text?: string, images?: string[], files?: string[]) => {
			const trimmedInput = text?.trim()

			if (isStreaming) {
				await TaskServiceClient.cancelTask(EmptyRequest.create({}))
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "auto_approval_max_req_reached":
					startNewTask()
					break
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
					if (trimmedInput || (images && images.length > 0) || (files && files.length > 0)) {
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
					// Clear input state after sending
					setInputValue("")
					setActiveQuote(null)
					setSelectedImages([])
					setSelectedFiles([])
					break
			}
			setSendingDisabled(true)
			setEnableButtons(false)

			// Reset auto-scroll
			if ("disableAutoScrollRef" in chatState) {
				;(chatState as any).disableAutoScrollRef.current = false
			}
		},
		[
			isStreaming,
			clineAsk,
			startNewTask,
			setInputValue,
			setActiveQuote,
			setSelectedImages,
			setSelectedFiles,
			setSendingDisabled,
			setEnableButtons,
			setDidClickCancel,
			chatState,
		],
	)

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		handlePrimaryButtonClick,
		handleSecondaryButtonClick,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
