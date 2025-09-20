import type { ClineMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/cline/task"
import { useCallback } from "react"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, task management, and message queuing
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
		addToQueue,
		queuedMessages,
		clearQueue,
		removeFromQueue,
	} = chatState

	// Handle sending a message or queuing it if sending is disabled
	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend || images.length > 0 || files.length > 0

			// If sending is disabled and there's content, queue the message
			if (chatState.sendingDisabled && hasContent) {
				console.log("[ChatView] handleSendMessage - Queuing message:", messageToSend)
				
				// Prepend the active quote if it exists
				if (activeQuote) {
					const prefix = "[context] \n> "
					const formattedQuote = activeQuote
					const suffix = "\n[/context] \n\n"
					messageToSend = `${prefix} ${formattedQuote} ${suffix} ${messageToSend}`
				}

				addToQueue(messageToSend, images, files)
				setInputValue("")
				setActiveQuote(null)
				setSelectedImages([])
				setSelectedFiles([])
				return
			}

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
			addToQueue,
		],
	)

	// Start a new task
	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		clearQueue() // Clear any queued messages when starting a new task
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote, clearQueue])

	// Process queued messages
	const processQueue = useCallback(async () => {
		if (queuedMessages.length === 0 || chatState.sendingDisabled) {
			console.log("[ChatView] processQueue - Cannot process: queue empty or sending disabled")
			return
		}

		console.log("[ChatView] processQueue - Processing", queuedMessages.length, "queued messages")
		
		// Process messages in FIFO order
		for (const queuedMessage of queuedMessages) {
			// Double-check state hasn't changed during processing
			if (chatState.sendingDisabled) {
				console.log("[ChatView] processQueue - Sending became disabled during processing, stopping")
				break
			}

			console.log("[ChatView] processQueue - Processing queued message:", queuedMessage.text.substring(0, 100) + "...")
			
			// Remove from queue before processing to prevent reprocessing
			removeFromQueue(queuedMessage.id)

			try {
				// Send the queued message
				if (messages.length === 0) {
					await TaskServiceClient.newTask(NewTaskRequest.create({ 
						text: queuedMessage.text, 
						images: queuedMessage.images, 
						files: queuedMessage.files 
					}))
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
									text: queuedMessage.text,
									images: queuedMessage.images,
									files: queuedMessage.files,
								}),
							)
							break
						default:
							console.warn("[ChatView] processQueue - Unknown clineAsk type:", clineAsk)
					}
				} else {
					console.warn("[ChatView] processQueue - No clineAsk available, cannot send message")
					continue
				}

				// Set sending disabled after sending (matches behavior of handleSendMessage)
				setSendingDisabled(true)
				setEnableButtons(false)

				// Reset auto-scroll
				if ("disableAutoScrollRef" in chatState) {
					;(chatState as any).disableAutoScrollRef.current = false
				}

				console.log("[ChatView] processQueue - Successfully processed message")
				
				// Only process one message at a time to avoid overwhelming the system
				break
			} catch (error) {
				console.error("[ChatView] processQueue - Error processing queued message:", error)
				// Continue with next message if this one failed
			}
		}
	}, [queuedMessages, chatState.sendingDisabled, removeFromQueue, messages.length, clineAsk, setSendingDisabled, setEnableButtons, chatState])

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
				case "retry":
					// For API retry (api_req_failed), always send simple approval without content
					await TaskServiceClient.askResponse(
						AskResponseRequest.create({
							responseType: "yesButtonClicked",
						}),
					)
					clearInputState()
					break
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
					}
					clearInputState()
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

				case "new_task":
					if (clineAsk === "new_task") {
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

	// Handle task close button click
	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		executeButtonAction,
		handleTaskCloseButtonClick,
		startNewTask,
		processQueue,
	}
}
