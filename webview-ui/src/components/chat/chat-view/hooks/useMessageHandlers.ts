import type { ClineMessage } from "@shared/ExtensionMessage"
import { BrowserSettings } from "@shared/proto/cline/browser"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { ApiProvider } from "@shared/proto/cline/models"
import { DictationSettings, FocusChainSettings, OpenaiReasoningEffort, PlanActMode, Viewport } from "@shared/proto/cline/state"
import {
	AskResponseRequest,
	AutoApprovalActions,
	AutoApprovalSettings,
	NewTaskRequest,
	TaskSettings,
} from "@shared/proto/cline/task"
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
					// Create comprehensive test TaskSettings to test all protobuf field types
					const testTaskSettings = TaskSettings.create({
						// String fields
						awsRegion: "us-west-2",
						anthropicBaseUrl: "https://api.anthropic.com",
						preferredLanguage: "en",
						customPrompt: "compact",
						openAiBaseUrl: "https://api.openai.com",
						vertexProjectId: "test-project",
						defaultTerminalProfile: "bash",

						// Boolean fields
						awsUseCrossRegionInference: true,
						strictPlanModeEnabled: false,
						yoloModeToggled: false,
						enableCheckpointsSetting: true,
						useAutoCondense: false,
						liteLlmUsePromptCache: true,

						// Integer fields
						requestTimeoutMs: 30000,
						fireworksModelMaxTokens: 4096,
						shellIntegrationTimeout: 5000,
						terminalOutputLineLimit: 1000,
						planModeThinkingBudgetTokens: 64000,
						actModeThinkingBudgetTokens: 32000,

						// Double fields
						autoCondenseThreshold: 0.8,

						// Enum fields
						openaiReasoningEffort: OpenaiReasoningEffort.MEDIUM,
						mode: PlanActMode.PLAN,
						telemetrySetting: "enabled",
						planModeApiProvider: ApiProvider.ANTHROPIC,
						actModeApiProvider: ApiProvider.ANTHROPIC,

						// Complex nested objects
						autoApprovalSettings: AutoApprovalSettings.create({
							version: 1,
							enabled: true,
							maxRequests: 10,
							enableNotifications: false,
							favorites: ["read_files", "edit_files"],
							actions: AutoApprovalActions.create({
								readFiles: true,
								editFiles: true,
								executeSafeCommands: false,
								executeAllCommands: false,
								useBrowser: true,
								useMcp: false,
								readFilesExternally: false,
								editFilesExternally: false,
							}),
						}),

						browserSettings: BrowserSettings.create({
							viewport: Viewport.create({ width: 1280, height: 800 }),
							remoteBrowserEnabled: false,
							disableToolUse: false,
							chromeExecutablePath: "/usr/bin/google-chrome",
							customArgs: "--no-sandbox",
						}),

						dictationSettings: DictationSettings.create({
							featureEnabled: true,
							dictationEnabled: false,
							dictationLanguage: "en-US",
						}),

						focusChainSettings: FocusChainSettings.create({
							enabled: false,
							remindClineInterval: 300,
						}),

						// Model configurations using Anthropic
						planModeApiModelId: "claude-sonnet-4-20250514",
						actModeApiModelId: "claude-sonnet-4-20250514",
						planModeReasoningEffort: "medium",
						actModeReasoningEffort: "low",

						// Headers map
						openAiHeaders: {
							Authorization: "Bearer test-key",
							"Content-Type": "application/json",
						},
					})

					await TaskServiceClient.newTask(
						NewTaskRequest.create({
							text: messageToSend,
							images,
							files,
							taskSettings: testTaskSettings,
						}),
					)
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
	}
}
