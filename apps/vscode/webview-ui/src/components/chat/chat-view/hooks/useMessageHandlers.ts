import type { ClineMessage } from "@shared/ExtensionMessage"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest, NewTaskRequest } from "@shared/proto/cline/task"
import { useCallback, useRef } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SlashServiceClient, TaskServiceClient } from "@/services/grpc-client"
import type { ButtonActionType } from "../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../types/chatTypes"

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(messages: ClineMessage[], chatState: ChatState): MessageHandlers {
	const { backgroundCommandRunning, turnState } = useExtensionState()
	const {
		setInputValue,
		activeQuote,
		setActiveQuote,
		setSelectedImages,
		setSelectedFiles,
		sendingDisabled,
		setSendingDisabled,
		enableButtons,
		setEnableButtons,
		setPendingUserMessage,
		clineAsk,
		lastMessage,
	} = chatState
	const cancelInFlightRef = useRef(false)

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

			// Intercept the built-in compaction commands when an active task exists.
			// `/compact` (and its alias `/smol`) must run a real SDK manual
			// compaction via the condense RPC — sending the literal text to the
			// model would make it improvise a fake summary instead of compacting
			// the context window (CLINE-2503). With no active task there is nothing
			// to compact, so fall through to normal new-task handling.
			if (messages.length > 0 && (messageToSend === "/compact" || messageToSend === "/smol")) {
				await SlashServiceClient.condense(StringRequest.create({ value: "compact" })).catch((err) =>
					console.error("Failed to compact task:", err),
				)
				setInputValue("")
				setActiveQuote(null)
				if ("disableAutoScrollRef" in chatState) {
					;(chatState as any).disableAutoScrollRef.current = false
				}
				return
			}

			if (hasContent) {
				console.log("[ChatView] handleSendMessage - Sending message:", messageToSend)
				let messageSent = false
				const clearSentMessageState = () => {
					setInputValue("")
					setActiveQuote(null)
					setSendingDisabled(true)
					setSelectedImages([])
					setSelectedFiles([])
					setEnableButtons(false)
				}
				const restorePendingMessageState = () => {
					setInputValue(text)
					setActiveQuote(activeQuote)
					setSendingDisabled(sendingDisabled)
					setSelectedImages(images)
					setSelectedFiles(files)
					setEnableButtons(enableButtons)
				}
				const sendAskResponseWithPendingState = async (
					request: ReturnType<typeof AskResponseRequest.create>,
					options: { showPendingMessage?: boolean } = {},
				) => {
					clearSentMessageState()
					if (options.showPendingMessage) {
						const afterTs = Math.max(0, ...messages.map((message) => message.ts))
						setPendingUserMessage({
							afterTs,
							message: {
								ts: Date.now(),
								type: "say",
								say: "user_feedback",
								text: request.text ?? "",
								images: request.images,
								files: request.files,
								partial: false,
							},
						})
					}
					try {
						await TaskServiceClient.askResponse(request)
					} catch (error) {
						if (options.showPendingMessage) {
							setPendingUserMessage(undefined)
						}
						restorePendingMessageState()
						throw error
					}
				}

				if (messages.length === 0) {
					const request = NewTaskRequest.create({
						text: messageToSend,
						images,
						files,
					})
					clearSentMessageState()
					try {
						await TaskServiceClient.newTask(request)
					} catch (error) {
						restorePendingMessageState()
						throw error
					}
					messageSent = true
				} else if (clineAsk) {
					// For resume_task and resume_completed_task, use yesButtonClicked to match Resume button behavior
					// This ensures Enter key and Resume button work identically
					if (clineAsk === "resume_task" || clineAsk === "resume_completed_task") {
						await sendAskResponseWithPendingState(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
								text: messageToSend,
								images,
								files,
							}),
						)
						messageSent = true
					} else {
						// All other ask types use messageResponse
						switch (clineAsk) {
							case "followup":
							case "plan_mode_respond":
							case "tool":
							case "browser_action_launch":
							case "command":
							case "command_output":
							case "use_mcp_server":
							case "use_subagents":
							case "completion_result":
							case "mistake_limit_reached":
							case "api_req_failed":
							case "new_task":
							case "condense":
							case "report_bug":
								await sendAskResponseWithPendingState(
									AskResponseRequest.create({
										responseType: "messageResponse",
										text: messageToSend,
										images,
										files,
									}),
									{ showPendingMessage: turnState?.phase !== "streaming" },
								)
								messageSent = true
								break
						}
					}
				} else if (messages.length > 0) {
					// No clineAsk set, but there is an existing conversation. Route this to the
					// active session as a follow-up when either:
					//
					//   1. The authoritative turnState says the conversation is continuable —
					//      phases "completed" / "awaiting_followup" (the agent finished or is
					//      waiting for the user) or "streaming" (interrupt with feedback). The SDK
					//      does not emit a trailing ask:"completion_result", so clineAsk is
					//      undefined even when the user can keep talking; turnState is the source
					//      of truth.
					//   2. Legacy fallback (no turnState): the task looks actively running from the
					//      message tail.
					const lastMessage = messages[messages.length - 1]
					const isTaskRunning =
						lastMessage.partial === true || (lastMessage.type === "say" && lastMessage.say === "api_req_started")
					const turnAllowsFollowup =
						turnState?.phase === "completed" ||
						turnState?.phase === "awaiting_followup" ||
						turnState?.phase === "streaming"

					if (turnAllowsFollowup || isTaskRunning) {
						// Continue the conversation / interrupt with feedback.
						await sendAskResponseWithPendingState(
							AskResponseRequest.create({
								responseType: "messageResponse",
								text: messageToSend,
								images,
								files,
							}),
							{
								showPendingMessage: turnState?.phase === "completed" || turnState?.phase === "awaiting_followup",
							},
						)
						messageSent = true
					}
				}

				// New tasks clear optimistically before the RPC; the repeated success cleanup is idempotent.
				if (messageSent) {
					clearSentMessageState()

					// Reset auto-scroll
					if ("disableAutoScrollRef" in chatState) {
						;(chatState as any).disableAutoScrollRef.current = false
					}
				}
			}
		},
		[
			messages,
			clineAsk,
			turnState,
			activeQuote,
			setInputValue,
			setActiveQuote,
			sendingDisabled,
			setSendingDisabled,
			setSelectedImages,
			setSelectedFiles,
			enableButtons,
			setEnableButtons,
			setPendingUserMessage,
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
					}
					clearInputState()
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

				case "cancel": {
					if (cancelInFlightRef.current) {
						return
					}
					cancelInFlightRef.current = true
					setSendingDisabled(true)
					setEnableButtons(false)
					try {
						if (backgroundCommandRunning) {
							await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({})).catch((err) =>
								console.error("Failed to cancel background command:", err),
							)
						}
						await TaskServiceClient.cancelTask(EmptyRequest.create({}))
					} finally {
						cancelInFlightRef.current = false
						// Clear any pending state that might interfere with resume
						setSendingDisabled(false)
						setEnableButtons(true)
					}
					break
				}

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
		[
			clineAsk,
			lastMessage,
			messages,
			clearInputState,
			handleSendMessage,
			startNewTask,
			chatState,
			backgroundCommandRunning,
			setSendingDisabled,
			setEnableButtons,
		],
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
	}
}
