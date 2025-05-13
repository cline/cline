import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent, useMount } from "react-use"
import debounce from "debounce"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import removeMd from "remove-markdown"
import { Trans } from "react-i18next"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import {
	ClineAsk,
	ClineMessage,
	ClineSayBrowserAction,
	ClineSayTool,
	ExtensionMessage,
} from "@roo/shared/ExtensionMessage"
import { McpServer, McpTool } from "@roo/shared/mcp"
import { findLast } from "@roo/shared/array"
import { combineApiRequests } from "@roo/shared/combineApiRequests"
import { combineCommandSequences } from "@roo/shared/combineCommandSequences"
import { getApiMetrics } from "@roo/shared/getApiMetrics"
import { AudioType } from "@roo/shared/WebviewMessage"
import { getAllModes } from "@roo/shared/modes"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { validateCommand } from "@src/utils/command-validation"
import { useAppTranslation } from "@src/i18n/TranslationContext"

import TelemetryBanner from "../common/TelemetryBanner"
import { useTaskSearch } from "../history/useTaskSearch"
import HistoryPreview from "../history/HistoryPreview"
import RooHero from "@src/components/welcome/RooHero"
import RooTips from "@src/components/welcome/RooTips"
import Announcement from "./Announcement"
import BrowserSessionRow from "./BrowserSessionRow"
import ChatRow from "./ChatRow"
import ChatTextArea from "./ChatTextArea"
import TaskHeader from "./TaskHeader"
import AutoApproveMenu from "./AutoApproveMenu"
import SystemPromptWarning from "./SystemPromptWarning"
import { CheckpointWarning } from "./CheckpointWarning"

export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
}

export const MAX_IMAGES_PER_MESSAGE = 20 // Anthropic limits to 20 images

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

const ChatViewComponent: React.ForwardRefRenderFunction<ChatViewRef, ChatViewProps> = (
	{ isHidden, showAnnouncement, hideAnnouncement },
	ref,
) => {
	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}`
	const {
		clineMessages: messages,
		taskHistory,
		apiConfiguration,
		mcpServers,
		alwaysAllowBrowser,
		alwaysAllowReadOnly,
		alwaysAllowReadOnlyOutsideWorkspace,
		alwaysAllowWrite,
		alwaysAllowWriteOutsideWorkspace,
		alwaysAllowExecute,
		alwaysAllowMcp,
		allowedCommands,
		writeDelayMs,
		mode,
		setMode,
		autoApprovalEnabled,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		customModes,
		telemetrySetting,
		hasSystemPromptOverride,
		historyPreviewCollapsed, // Added historyPreviewCollapsed
	} = useExtensionState()

	const { tasks } = useTaskSearch()

	// Initialize expanded state based on the persisted setting (default to expanded if undefined)
	const [isExpanded, setIsExpanded] = useState(
		historyPreviewCollapsed === undefined ? true : !historyPreviewCollapsed,
	)

	const toggleExpanded = useCallback(() => {
		const newState = !isExpanded
		setIsExpanded(newState)
		// Send message to extension to persist the new collapsed state
		vscode.postMessage({ type: "setHistoryPreviewCollapsed", bool: !newState })
	}, [isExpanded])

	// Leaving this less safe version here since if the first message is not a
	// task, then the extension is in a bad state and needs to be debugged (see
	// Cline.abort).
	const task = useMemo(() => messages.at(0), [messages])

	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])

	// Has to be after api_req_finished are all reduced into api_req_started messages.
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

	// we need to hold on to the ask because useEffect > lastMessage will always let us know when an ask comes in and handle it, but by the time handleMessage is called, the last message might not be the ask anymore (it could be a say that followed)
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [didClickCancel, setDidClickCancel] = useState(false)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(false)
	const lastTtsRef = useRef<string>("")
	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [showCheckpointWarning, setShowCheckpointWarning] = useState<boolean>(false)

	// UI layout depends on the last 2 messages
	// (since it relies on the content of these messages, we are deep comparing. i.e. the button state after hitting button sets enableButtons to false, and this effect otherwise would have to true again even if messages didn't change
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	function playSound(audioType: AudioType) {
		vscode.postMessage({ type: "playSound", audioType })
	}

	function playTts(text: string) {
		vscode.postMessage({ type: "playTts", text })
	}

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSound("progress_loop")
							setSendingDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:retry.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "mistake_limit_reached":
							playSound("progress_loop")
							setSendingDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedAnyways.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "followup":
							if (!isPartial) {
								playSound("notification")
							}
							setSendingDisabled(isPartial)
							setClineAsk("followup")
							// setting enable buttons to `false` would trigger a focus grab when
							// the text area is enabled which is undesirable.
							// We have no buttons for this tool, so no problem having them "enabled"
							// to workaround this issue.  See #1358.
							setEnableButtons(true)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "tool":
							if (!isAutoApproved(lastMessage) && !isPartial) {
								playSound("notification")
							}
							setSendingDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
								case "insertContent":
									setPrimaryButtonText(t("chat:save.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
								case "finishTask":
									setPrimaryButtonText(t("chat:completeSubtaskAndReturn"))
									setSecondaryButtonText(undefined)
									break
								default:
									setPrimaryButtonText(t("chat:approve.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
							}
							break
						case "browser_action_launch":
							if (!isAutoApproved(lastMessage) && !isPartial) {
								playSound("notification")
							}
							setSendingDisabled(isPartial)
							setClineAsk("browser_action_launch")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command":
							if (!isAutoApproved(lastMessage) && !isPartial) {
								playSound("notification")
							}
							setSendingDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:runCommand.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command_output":
							setSendingDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
							setSecondaryButtonText(t("chat:killCommand.title"))
							break
						case "use_mcp_server":
							if (!isAutoApproved(lastMessage) && !isPartial) {
								playSound("notification")
							}
							setSendingDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "completion_result":
							// extension waiting for feedback. but we can just present a new task button
							if (!isPartial) {
								playSound("celebration")
							}
							setSendingDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							if (!isAutoApproved(lastMessage) && !isPartial) {
								playSound("notification")
							}
							setSendingDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:resumeTask.title"))
							setSecondaryButtonText(t("chat:terminate.title"))
							setDidClickCancel(false) // special case where we reset the cancel button state
							break
						case "resume_completed_task":
							if (!isPartial) {
								playSound("celebration")
							}
							setSendingDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
					}
					break
				case "say":
					// Don't want to reset since there could be a "say" after
					// an "ask" while ask is waiting for response.
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
							setSendingDisabled(true)
							break
						case "api_req_started":
							if (secondLastMessage?.ask === "command_output") {
								// If the last ask is a command_output, and we
								// receive an api_req_started, then that means
								// the command has finished and we don't need
								// input from the user anymore (in every other
								// case, the user has to interact with input
								// field or buttons to continue, which does the
								// following automatically).
								setInputValue("")
								setSendingDisabled(true)
								setSelectedImages([])
								setClineAsk(undefined)
								setEnableButtons(false)
							}
							break
						case "api_req_finished":
						case "error":
						case "text":
						case "browser_action":
						case "browser_action_result":
						case "command_output":
						case "mcp_server_request_started":
						case "mcp_server_response":
						case "completion_result":
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	useEffect(() => {
		if (messages.length === 0) {
			setSendingDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	useEffect(() => setExpandedRows({}), [task?.ts])

	const isStreaming = useMemo(() => {
		// Checking clineAsk isn't enough since messages effect may be called
		// again for a tool for example, set clineAsk to its value, and if the
		// next message is not an ask then it doesn't reset. This is likely due
		// to how much more often we're updating messages as compared to before,
		// and should be resolved with optimizations as it's likely a rendering
		// bug. But as a final guard for now, the cancel button will show if the
		// last message is not an ask.
		const isLastAsk = !!modifiedMessages.at(-1)?.ask

		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined

		if (isToolCurrentlyAsking) {
			return false
		}

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true

		if (isLastMessagePartial) {
			return true
		} else {
			const lastApiReqStarted = findLast(modifiedMessages, (message) => message.say === "api_req_started")

			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost

				if (cost === undefined) {
					return true // API request has not finished yet.
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	const handleChatReset = useCallback(() => {
		// Only reset message-specific state, preserving mode.
		setInputValue("")
		setSendingDisabled(true)
		setSelectedImages([])
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
		disableAutoScrollRef.current = false
	}, [])

	const handleSendMessage = useCallback(
		(text: string, images: string[]) => {
			text = text.trim()

			if (text || images.length > 0) {
				if (messages.length === 0) {
					vscode.postMessage({ type: "newTask", text, images })
				} else if (clineAsk) {
					switch (clineAsk) {
						case "followup":
						case "tool":
						case "browser_action_launch":
						case "command": // User can provide feedback to a tool or command use.
						case "command_output": // User can send input to command stdin.
						case "use_mcp_server":
						case "completion_result": // If this happens then the user has feedback for the completion result.
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text, images })
							break
						// There is no other case that a textfield should be enabled.
					}
				}

				handleChatReset()
			}
		},
		[messages.length, clineAsk, handleChatReset],
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text

			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => vscode.postMessage({ type: "clearTask" }), [])

	// This logic depends on the useEffect[messages] above to set clineAsk,
	// after which buttons are shown and we then send an askResponse to the
	// extension.
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			const trimmedInput = text?.trim()

			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
				case "resume_task":
				case "mistake_limit_reached":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
						})
					} else {
						vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
					}
					// Clear input state after sending
					setInputValue("")
					setSelectedImages([])
					break
				case "completion_result":
				case "resume_completed_task":
					// Waiting for feedback, but we can just present a new task button
					startNewTask()
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "continue" })
					break
			}

			setSendingDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
		},
		[clineAsk, startNewTask],
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			const trimmedInput = text?.trim()

			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
						})
					} else {
						// Responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
					}
					// Clear input state after sending
					setInputValue("")
					setSelectedImages([])
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "abort" })
					break
			}
			setSendingDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
		},
		[clineAsk, startNewTask, isStreaming],
	)

	const handleTaskCloseButtonClick = useCallback(() => startNewTask(), [startNewTask])

	const { info: model } = useSelectedModel(apiConfiguration)

	const selectImages = useCallback(() => vscode.postMessage({ type: "selectImages" }), [])

	const shouldDisableImages =
		!model?.supportsImages || sendingDisabled || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !sendingDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
						case "focusInput":
							textAreaRef.current?.focus()
							break
					}
					break
				case "selectedImages":
					const newImages = message.images ?? []
					if (newImages.length > 0) {
						setSelectedImages((prevImages) =>
							[...prevImages, ...newImages].slice(0, MAX_IMAGES_PER_MESSAGE),
						)
					}
					break
				case "invoke":
					switch (message.invoke!) {
						case "newChat":
							handleChatReset()
							break
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "setChatBoxMessage":
							handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
							break
						case "secondaryButtonClick":
							handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
							break
					}
			}
			// textAreaRef.current is not explicitly required here since React
			// guarantees that ref will be stable across re-renders, and we're
			// not using its value but its reference.
		},
		[
			isHidden,
			sendingDisabled,
			enableButtons,
			handleChatReset,
			handleSendMessage,
			handleSetChatBoxMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
		],
	)

	useEvent("message", handleMessage)

	// NOTE: the VSCode window needs to be focused for this to work.
	useMount(() => textAreaRef.current?.focus())

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)

		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, sendingDisabled, enableButtons])

	const visibleMessages = useMemo(() => {
		return modifiedMessages.filter((message) => {
			switch (message.ask) {
				case "completion_result":
					// Don't show a chat row for a completion_result ask without
					// text. This specific type of message only occurs if cline
					// wants to execute a command as part of its completion
					// result, in which case we interject the completion_result
					// tool with the execute_command tool.
					if (message.text === "") {
						return false
					}
					break
				case "api_req_failed": // This message is used to update the latest `api_req_started` that the request failed.
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished": // `combineApiRequests` removes this from `modifiedMessages` anyways.
				case "api_req_retried": // This message is used to update the latest `api_req_started` that the request was retried.
				case "api_req_deleted": // Aggregated `api_req` metrics from deleted messages.
					return false
				case "api_req_retry_delayed":
					// Only show the retry message if it's the last message or
					// the last messages is api_req_retry_delayed+resume_task.
					const last1 = modifiedMessages.at(-1)
					const last2 = modifiedMessages.at(-2)
					if (last1?.ask === "resume_task" && last2 === message) {
						return true
					}
					return message === last1
				case "text":
					// Sometimes cline returns an empty text message, we don't
					// want to render these. (We also use a say text for user
					// messages, so in case they just sent images we still
					// render that.)
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
						return false
					}
					break
				case "mcp_server_request_started":
					return false
			}
			return true
		})
	}, [modifiedMessages])

	const isReadOnlyToolAction = useCallback((message: ClineMessage | undefined) => {
		if (message?.type === "ask") {
			if (!message.text) {
				return true
			}

			const tool = JSON.parse(message.text)

			return [
				"readFile",
				"listFiles",
				"listFilesTopLevel",
				"listFilesRecursive",
				"listCodeDefinitionNames",
				"searchFiles",
			].includes(tool.tool)
		}

		return false
	}, [])

	const isWriteToolAction = useCallback((message: ClineMessage | undefined) => {
		if (message?.type === "ask") {
			if (!message.text) {
				return true
			}

			const tool = JSON.parse(message.text)

			return [
				"editedExistingFile",
				"appliedDiff",
				"newFileCreated",
				"searchAndReplace",
				"insertContent",
			].includes(tool.tool)
		}

		return false
	}, [])

	const isMcpToolAlwaysAllowed = useCallback(
		(message: ClineMessage | undefined) => {
			if (message?.type === "ask" && message.ask === "use_mcp_server") {
				if (!message.text) {
					return true
				}

				const mcpServerUse = JSON.parse(message.text) as { type: string; serverName: string; toolName: string }

				if (mcpServerUse.type === "use_mcp_tool") {
					const server = mcpServers?.find((s: McpServer) => s.name === mcpServerUse.serverName)
					const tool = server?.tools?.find((t: McpTool) => t.name === mcpServerUse.toolName)
					return tool?.alwaysAllow || false
				}
			}

			return false
		},
		[mcpServers],
	)

	// Check if a command message is allowed.
	const isAllowedCommand = useCallback(
		(message: ClineMessage | undefined): boolean => {
			if (message?.type !== "ask") return false
			return validateCommand(message.text || "", allowedCommands || [])
		},
		[allowedCommands],
	)

	const isAutoApproved = useCallback(
		(message: ClineMessage | undefined) => {
			if (!autoApprovalEnabled || !message || message.type !== "ask") {
				return false
			}

			if (message.ask === "browser_action_launch") {
				return alwaysAllowBrowser
			}

			if (message.ask === "use_mcp_server") {
				return alwaysAllowMcp && isMcpToolAlwaysAllowed(message)
			}

			if (message.ask === "command") {
				return alwaysAllowExecute && isAllowedCommand(message)
			}

			// For read/write operations, check if it's outside workspace and if
			// we have permission for that.
			if (message.ask === "tool") {
				let tool: any = {}

				try {
					tool = JSON.parse(message.text || "{}")
				} catch (error) {
					console.error("Failed to parse tool:", error)
				}

				if (!tool) {
					return false
				}

				if (tool?.tool === "fetchInstructions") {
					if (tool.content === "create_mode") {
						return alwaysAllowModeSwitch
					}

					if (tool.content === "create_mcp_server") {
						return alwaysAllowMcp
					}
				}

				if (tool?.tool === "switchMode") {
					return alwaysAllowModeSwitch
				}

				if (["newTask", "finishTask"].includes(tool?.tool)) {
					return alwaysAllowSubtasks
				}

				const isOutsideWorkspace = !!tool.isOutsideWorkspace

				if (isReadOnlyToolAction(message)) {
					return alwaysAllowReadOnly && (!isOutsideWorkspace || alwaysAllowReadOnlyOutsideWorkspace)
				}

				if (isWriteToolAction(message)) {
					return alwaysAllowWrite && (!isOutsideWorkspace || alwaysAllowWriteOutsideWorkspace)
				}
			}

			return false
		},
		[
			autoApprovalEnabled,
			alwaysAllowBrowser,
			alwaysAllowReadOnly,
			alwaysAllowReadOnlyOutsideWorkspace,
			isReadOnlyToolAction,
			alwaysAllowWrite,
			alwaysAllowWriteOutsideWorkspace,
			isWriteToolAction,
			alwaysAllowExecute,
			isAllowedCommand,
			alwaysAllowMcp,
			isMcpToolAlwaysAllowed,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
		],
	)

	useEffect(() => {
		// This ensures the first message is not read, future user messages are
		// labeled as `user_feedback`.
		if (lastMessage && messages.length > 1) {
			if (
				lastMessage.text && // has text
				(lastMessage.say === "text" || lastMessage.say === "completion_result") && // is a text message
				!lastMessage.partial && // not a partial message
				!lastMessage.text.startsWith("{") // not a json object
			) {
				let text = lastMessage?.text || ""
				const mermaidRegex = /```mermaid[\s\S]*?```/g
				// remove mermaid diagrams from text
				text = text.replace(mermaidRegex, "")
				// remove markdown from text
				text = removeMd(text)

				// ensure message is not a duplicate of last read message
				if (text !== lastTtsRef.current) {
					try {
						playTts(text)
						lastTtsRef.current = text
					} catch (error) {
						console.error("Failed to execute text-to-speech:", error)
					}
				}
			}
		}

		// Update previous value.
		setWasStreaming(isStreaming)
	}, [isStreaming, lastMessage, wasStreaming, isAutoApproved, messages.length])

	const isBrowserSessionMessage = (message: ClineMessage): boolean => {
		// Which of visible messages are browser session messages, see above.
		if (message.type === "ask") {
			return ["browser_action_launch"].includes(message.ask!)
		}

		if (message.type === "say") {
			return ["api_req_started", "text", "browser_action", "browser_action_result"].includes(message.say!)
		}

		return false
	}

	const groupedMessages = useMemo(() => {
		const result: (ClineMessage | ClineMessage[])[] = []
		let currentGroup: ClineMessage[] = []
		let isInBrowserSession = false

		const endBrowserSession = () => {
			if (currentGroup.length > 0) {
				result.push([...currentGroup])
				currentGroup = []
				isInBrowserSession = false
			}
		}

		visibleMessages.forEach((message) => {
			if (message.ask === "browser_action_launch") {
				// Complete existing browser session if any.
				endBrowserSession()
				// Start new.
				isInBrowserSession = true
				currentGroup.push(message)
			} else if (isInBrowserSession) {
				// End session if `api_req_started` is cancelled.

				if (message.say === "api_req_started") {
					// Get last `api_req_started` in currentGroup to check if
					// it's cancelled. If it is then this api req is not part
					// of the current browser session.
					const lastApiReqStarted = [...currentGroup].reverse().find((m) => m.say === "api_req_started")

					if (lastApiReqStarted?.text !== null && lastApiReqStarted?.text !== undefined) {
						const info = JSON.parse(lastApiReqStarted.text)
						const isCancelled = info.cancelReason !== null && info.cancelReason !== undefined

						if (isCancelled) {
							endBrowserSession()
							result.push(message)
							return
						}
					}
				}

				if (isBrowserSessionMessage(message)) {
					currentGroup.push(message)

					// Check if this is a close action
					if (message.say === "browser_action") {
						const browserAction = JSON.parse(message.text || "{}") as ClineSayBrowserAction
						if (browserAction.action === "close") {
							endBrowserSession()
						}
					}
				} else {
					// complete existing browser session if any
					endBrowserSession()
					result.push(message)
				}
			} else {
				result.push(message)
			}
		})

		// Handle case where browser session is the last group
		if (currentGroup.length > 0) {
			result.push([...currentGroup])
		}

		return result
	}, [visibleMessages])

	// scrolling

	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(() => virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "smooth" }), 10, {
				immediate: true,
			}),
		[],
	)

	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // Instant causes crash.
		})
	}, [])

	// Scroll when user toggles certain rows.
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			const isCollapsing = expandedRows[ts] ?? false
			const lastGroup = groupedMessages.at(-1)
			const isLast = Array.isArray(lastGroup) ? lastGroup[0].ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = groupedMessages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? secondToLastGroup[0].ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => ({ ...prev, [ts]: !prev[ts] }))

			// Disable auto scroll when user expands row
			if (!isCollapsing) {
				disableAutoScrollRef.current = true
			}

			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => scrollToBottomAuto(), 0)
				return () => clearTimeout(timer)
			} else if (isLast || isSecondToLast) {
				if (isCollapsing) {
					if (isSecondToLast && !isLastCollapsedApiReq) {
						return
					}

					const timer = setTimeout(() => scrollToBottomAuto(), 0)
					return () => clearTimeout(timer)
				} else {
					const timer = setTimeout(() => {
						virtuosoRef.current?.scrollToIndex({
							index: groupedMessages.length - (isLast ? 1 : 2),
							align: "start",
						})
					}, 0)

					return () => clearTimeout(timer)
				}
			}
		},
		[groupedMessages, expandedRows, scrollToBottomAuto, isAtBottom],
	)

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (!disableAutoScrollRef.current) {
				if (isTaller) {
					scrollToBottomSmooth()
				} else {
					setTimeout(() => scrollToBottomAuto(), 0)
				}
			}
		},
		[scrollToBottomSmooth, scrollToBottomAuto],
	)

	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			setTimeout(() => scrollToBottomSmooth(), 50)
			// Don't cleanup since if visibleMessages.length changes it cancels.
			// return () => clearTimeout(timer)
		}
	}, [groupedMessages.length, scrollToBottomSmooth])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent

		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// User scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])

	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	// Effect to handle showing the checkpoint warning after a delay
	useEffect(() => {
		// Only show the warning when there's a task but no visible messages yet
		if (task && modifiedMessages.length === 0 && !isStreaming) {
			const timer = setTimeout(() => {
				setShowCheckpointWarning(true)
			}, 5000) // 5 seconds

			return () => clearTimeout(timer)
		}
	}, [task, modifiedMessages.length, isStreaming])

	// Effect to hide the checkpoint warning when messages appear
	useEffect(() => {
		if (modifiedMessages.length > 0 || isStreaming) {
			setShowCheckpointWarning(false)
		}
	}, [modifiedMessages.length, isStreaming])

	const placeholderText = task ? t("chat:typeMessage") : t("chat:typeTask")

	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage | ClineMessage[]) => {
			// browser session group
			if (Array.isArray(messageOrGroup)) {
				return (
					<BrowserSessionRow
						messages={messageOrGroup}
						isLast={index === groupedMessages.length - 1}
						lastModifiedMessage={modifiedMessages.at(-1)}
						onHeightChange={handleRowHeightChange}
						isStreaming={isStreaming}
						// Pass handlers for each message in the group
						isExpanded={(messageTs: number) => expandedRows[messageTs] ?? false}
						onToggleExpand={(messageTs: number) => {
							setExpandedRows((prev) => ({
								...prev,
								[messageTs]: !prev[messageTs],
							}))
						}}
					/>
				)
			}

			// regular message
			return (
				<ChatRow
					key={messageOrGroup.ts}
					message={messageOrGroup}
					isExpanded={expandedRows[messageOrGroup.ts] || false}
					onToggleExpand={() => toggleRowExpansion(messageOrGroup.ts)}
					lastModifiedMessage={modifiedMessages.at(-1)}
					isLast={index === groupedMessages.length - 1}
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
					onSuggestionClick={(answer: string, event?: React.MouseEvent) => {
						if (event?.shiftKey) {
							// Always append to existing text, don't overwrite
							setInputValue((currentValue) => {
								return currentValue !== "" ? `${currentValue} \n${answer}` : answer
							})
						} else {
							handleSendMessage(answer, [])
						}
					}}
				/>
			)
		},
		[
			expandedRows,
			modifiedMessages,
			groupedMessages.length,
			handleRowHeightChange,
			isStreaming,
			toggleRowExpansion,
			handleSendMessage,
		],
	)

	useEffect(() => {
		// Only proceed if we have an ask and buttons are enabled.
		if (!clineAsk || !enableButtons) {
			return
		}

		const autoApprove = async () => {
			if (lastMessage?.ask && isAutoApproved(lastMessage)) {
				// Note that `isAutoApproved` can only return true if
				// lastMessage is an ask of type "browser_action_launch",
				// "use_mcp_server", "command", or "tool".

				// Add delay for write operations.
				if (lastMessage.ask === "tool" && isWriteToolAction(lastMessage)) {
					await new Promise((resolve) => setTimeout(resolve, writeDelayMs))
				}

				vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })

				// This is copied from `handlePrimaryButtonClick`, which we used
				// to call from `autoApprove`. I'm not sure how many of these
				// things are actually needed.
				setInputValue("")
				setSelectedImages([])
				setSendingDisabled(true)
				setClineAsk(undefined)
				setEnableButtons(false)
			}
		}
		autoApprove()
	}, [
		clineAsk,
		enableButtons,
		handlePrimaryButtonClick,
		alwaysAllowBrowser,
		alwaysAllowReadOnly,
		alwaysAllowReadOnlyOutsideWorkspace,
		alwaysAllowWrite,
		alwaysAllowWriteOutsideWorkspace,
		alwaysAllowExecute,
		alwaysAllowMcp,
		messages,
		allowedCommands,
		mcpServers,
		isAutoApproved,
		lastMessage,
		writeDelayMs,
		isWriteToolAction,
	])

	// Function to handle mode switching
	const switchToNextMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const nextModeIndex = (currentModeIndex + 1) % allModes.length
		// Update local state and notify extension to sync mode change
		setMode(allModes[nextModeIndex].slug)
		vscode.postMessage({
			type: "mode",
			text: allModes[nextModeIndex].slug,
		})
	}, [mode, setMode, customModes])

	// Add keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check for Command + . (period)
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault() // Prevent default browser behavior
				switchToNextMode()
			}
		},
		[switchToNextMode],
	)

	// Add event listener
	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])

	useImperativeHandle(ref, () => ({
		acceptInput: () => {
			if (enableButtons && primaryButtonText) {
				handlePrimaryButtonClick(inputValue, selectedImages)
			} else if (!sendingDisabled && (inputValue.trim() || selectedImages.length > 0)) {
				handleSendMessage(inputValue, selectedImages)
			}
		},
	}))

	return (
		<div className={isHidden ? "hidden" : "fixed top-0 left-0 right-0 bottom-0 flex flex-col overflow-hidden"}>
			{showAnnouncement && <Announcement hideAnnouncement={hideAnnouncement} />}
			{task ? (
				<>
					<TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						doesModelSupportPromptCache={model?.supportsPromptCache ?? false}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						contextTokens={apiMetrics.contextTokens}
						onClose={handleTaskCloseButtonClick}
					/>

					{hasSystemPromptOverride && (
						<div className="px-3">
							<SystemPromptWarning />
						</div>
					)}

					{showCheckpointWarning && (
						<div className="px-3">
							<CheckpointWarning />
						</div>
					)}
				</>
			) : (
				<div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
					{/* Moved Task Bar Header Here */}
					{tasks.length !== 0 && (
						<div className="flex text-vscode-descriptionForeground w-full mx-auto px-5 pt-3">
							<div className="flex items-center gap-1 cursor-pointer" onClick={toggleExpanded}>
								{tasks.length < 10 && (
									<span className={`font-medium text-xs `}>{t("history:recentTasks")}</span>
								)}
								<span
									className={`codicon  ${isExpanded ? "codicon-eye" : "codicon-eye-closed"} scale-90`}
								/>
							</div>
						</div>
					)}
					<div
						className={` w-full flex flex-col gap-4 m-auto ${isExpanded && tasks.length > 0 ? "mt-0" : ""} px-3.5 min-[370px]:px-10 pt-5 transition-all duration-300`}>
						<RooHero />
						{telemetrySetting === "unset" && <TelemetryBanner />}
						{/* Show the task history preview if expanded and tasks exist */}
						{taskHistory.length > 0 && isExpanded && <HistoryPreview />}
						<p className="text-vscode-editor-foreground leading-tight font-vscode-font-family text-center">
							<Trans
								i18nKey="chat:about"
								components={{
									DocsLink: (
										<a href="https://docs.roocode.com/" target="_blank" rel="noopener noreferrer">
											the docs
										</a>
									),
								}}
							/>
						</p>
						<RooTips cycle={false} />
					</div>
				</div>
			)}

			{/* 
			// Flex layout explanation:
			// 1. Content div above uses flex: "1 1 0" to:
			//    - Grow to fill available space (flex-grow: 1) 
			//    - Shrink when AutoApproveMenu needs space (flex-shrink: 1)
			//    - Start from zero size (flex-basis: 0) to ensure proper distribution
			//    minHeight: 0 allows it to shrink below its content height
			//
			// 2. AutoApproveMenu uses flex: "0 1 auto" to:
			//    - Not grow beyond its content (flex-grow: 0)
			//    - Shrink when viewport is small (flex-shrink: 1) 
			//    - Use its content size as basis (flex-basis: auto)
			//    This ensures it takes its natural height when there's space
			//    but becomes scrollable when the viewport is too small
			*/}
			{!task && (
				<div className="mb-[-2px] flex-initial min-h-0">
					<AutoApproveMenu />
				</div>
			)}

			{task && (
				<>
					<div className="grow flex" ref={scrollContainerRef}>
						<Virtuoso
							ref={virtuosoRef}
							key={task.ts} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
							className="scrollable grow overflow-y-scroll"
							components={{
								Footer: () => <div className="h-[5px]" />, // Add empty padding at the bottom
							}}
							// increasing top by 3_000 to prevent jumping around when user collapses a row
							increaseViewportBy={{ top: 3_000, bottom: Number.MAX_SAFE_INTEGER }} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
							data={groupedMessages} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
							itemContent={itemContent}
							atBottomStateChange={(isAtBottom) => {
								setIsAtBottom(isAtBottom)
								if (isAtBottom) {
									disableAutoScrollRef.current = false
								}
								setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
							}}
							atBottomThreshold={10} // anything lower causes issues with followOutput
							initialTopMostItemIndex={groupedMessages.length - 1}
						/>
					</div>
					<AutoApproveMenu />
					{showScrollToBottom ? (
						<div className="flex px-[15px] pt-[10px]">
							<div
								className="bg-[color-mix(in_srgb,_var(--vscode-toolbar-hoverBackground)_55%,_transparent)] rounded-[3px] overflow-hidden cursor-pointer flex justify-center items-center flex-1 h-[25px] hover:bg-[color-mix(in_srgb,_var(--vscode-toolbar-hoverBackground)_90%,_transparent)] active:bg-[color-mix(in_srgb,_var(--vscode-toolbar-hoverBackground)_70%,_transparent)]"
								onClick={() => {
									scrollToBottomSmooth()
									disableAutoScrollRef.current = false
								}}
								title={t("chat:scrollToBottom")}>
								<span className="codicon codicon-chevron-down text-[18px]"></span>
							</div>
						</div>
					) : (
						<div
							className={`flex ${
								primaryButtonText || secondaryButtonText || isStreaming ? "px-[15px] pt-[10px]" : "p-0"
							} ${
								primaryButtonText || secondaryButtonText || isStreaming
									? enableButtons || (isStreaming && !didClickCancel)
										? "opacity-100"
										: "opacity-50"
									: "opacity-0"
							}`}>
							{primaryButtonText && !isStreaming && (
								<VSCodeButton
									appearance="primary"
									disabled={!enableButtons}
									className={secondaryButtonText ? "flex-1 mr-[6px]" : "flex-[2] mr-0"}
									title={
										primaryButtonText === t("chat:retry.title")
											? t("chat:retry.tooltip")
											: primaryButtonText === t("chat:save.title")
												? t("chat:save.tooltip")
												: primaryButtonText === t("chat:approve.title")
													? t("chat:approve.tooltip")
													: primaryButtonText === t("chat:runCommand.title")
														? t("chat:runCommand.tooltip")
														: primaryButtonText === t("chat:startNewTask.title")
															? t("chat:startNewTask.tooltip")
															: primaryButtonText === t("chat:resumeTask.title")
																? t("chat:resumeTask.tooltip")
																: primaryButtonText === t("chat:proceedAnyways.title")
																	? t("chat:proceedAnyways.tooltip")
																	: primaryButtonText ===
																		  t("chat:proceedWhileRunning.title")
																		? t("chat:proceedWhileRunning.tooltip")
																		: undefined
									}
									onClick={() => handlePrimaryButtonClick(inputValue, selectedImages)}>
									{primaryButtonText}
								</VSCodeButton>
							)}
							{(secondaryButtonText || isStreaming) && (
								<VSCodeButton
									appearance="secondary"
									disabled={!enableButtons && !(isStreaming && !didClickCancel)}
									className={isStreaming ? "flex-[2] ml-0" : "flex-1 ml-[6px]"}
									title={
										isStreaming
											? t("chat:cancel.tooltip")
											: secondaryButtonText === t("chat:startNewTask.title")
												? t("chat:startNewTask.tooltip")
												: secondaryButtonText === t("chat:reject.title")
													? t("chat:reject.tooltip")
													: secondaryButtonText === t("chat:terminate.title")
														? t("chat:terminate.tooltip")
														: undefined
									}
									onClick={() => handleSecondaryButtonClick(inputValue, selectedImages)}>
									{isStreaming ? t("chat:cancel.title") : secondaryButtonText}
								</VSCodeButton>
							)}
						</div>
					)}
				</>
			)}

			<ChatTextArea
				ref={textAreaRef}
				inputValue={inputValue}
				setInputValue={setInputValue}
				sendingDisabled={sendingDisabled}
				selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
				placeholderText={placeholderText}
				selectedImages={selectedImages}
				setSelectedImages={setSelectedImages}
				onSend={() => handleSendMessage(inputValue, selectedImages)}
				onSelectImages={selectImages}
				shouldDisableImages={shouldDisableImages}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				mode={mode}
				setMode={setMode}
				modeShortcutText={modeShortcutText}
			/>

			<div id="roo-portal" />
		</div>
	)
}

const ChatView = forwardRef(ChatViewComponent)

export default ChatView
