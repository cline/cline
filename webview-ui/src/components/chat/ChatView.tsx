import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent, useMount } from "react-use"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import styled from "styled-components"
import {
	ClineAsk,
	ClineMessage,
	ClineSayBrowserAction,
	ClineSayTool,
	ExtensionMessage,
} from "../../../../src/shared/ExtensionMessage"
import { findLast } from "../../../../src/shared/array"
import { combineApiRequests } from "../../../../src/shared/combineApiRequests"
import { combineCommandSequences } from "../../../../src/shared/combineCommandSequences"
import { getApiMetrics } from "../../../../src/shared/getApiMetrics"
import { AudioType } from "../../../../src/shared/WebviewMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import HistoryPreview from "../history/HistoryPreview"
import { normalizeApiConfiguration } from "../settings/ApiOptions"
import Announcement from "./Announcement"
import BrowserSessionRow from "./BrowserSessionRow"
import ChatRow from "./ChatRow"
import ChatTextArea from "./ChatTextArea"
import TaskHeader from "./TaskHeader"

interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

export const MAX_IMAGES_PER_MESSAGE = 20

const ChatView = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }: ChatViewProps) => {
	const { version, clineMessages: messages, taskHistory, apiConfiguration } = useExtensionState()
	const [countdown, setCountdown] = useState<number | null>(null)

	const task = useMemo(() => messages.at(0), [messages])
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

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
	const [autoAcceptEnabled, setAutoAcceptEnabled] = useState(false)
	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [hasStarted, setHasStarted] = useState(false)


	// Add effect for countdown timer
useEffect(() => {
    let countdownTimer: NodeJS.Timeout | undefined;
    
    if (autoAcceptEnabled && clineAsk === "command_output" && enableButtons) {
        setCountdown(10); // Start at 10 seconds
        countdownTimer = setInterval(() => {
            setCountdown(prev => {
                if (prev === null || prev <= 1) {
                    clearInterval(countdownTimer);
					//TODO: CHECK IF THIS IS THE RIGHT FUNCTION

                    vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" }); // Direct message instead of using handlePrimaryButtonClick
                    setTextAreaDisabled(true);
                    setClineAsk(undefined);
                    setEnableButtons(false);
                    return null;
                }
                return prev - 1;
            });
        }, 1000);
    } else {
        setCountdown(null);
    }

    return () => {
        if (countdownTimer) {
            clearInterval(countdownTimer);
        }
    };
}, [autoAcceptEnabled, clineAsk, enableButtons]);


	// UI layout depends on the last 2 messages
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	function playSound(audioType: AudioType) {
		vscode.postMessage({ type: "playSound", audioType })
	}

	function playSoundOnMessage(audioType: AudioType) {
		if (hasStarted && !isStreaming) {
			playSound(audioType)
		}
	}

	useDeepCompareEffect(() => {
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSoundOnMessage("progress_loop")
							setTextAreaDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText("Retry")
							setSecondaryButtonText("Start New Task")
							break
						case "mistake_limit_reached":
							playSoundOnMessage("progress_loop")
							setTextAreaDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText("Proceed Anyways")
							setSecondaryButtonText("Start New Task")
							break
						case "followup":
							playSoundOnMessage("notification")
							setTextAreaDisabled(isPartial)
							setClineAsk("followup")
							setEnableButtons(isPartial)
							break
						case "tool":
							playSoundOnMessage("notification")
							setTextAreaDisabled(isPartial)
							setClineAsk("tool")
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
							playSoundOnMessage("notification")
							setTextAreaDisabled(isPartial)
							setClineAsk("browser_action_launch")
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Approve")
							setSecondaryButtonText("Reject")
							break
						case "command":
							playSoundOnMessage("notification")
							setTextAreaDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Run Command")
							setSecondaryButtonText("Reject")
							break
						case "command_output":
							playSoundOnMessage("notification")
							setTextAreaDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(`Proceed While Running${countdown !== null ? ` (${countdown})` : ''}`)
							setSecondaryButtonText(undefined)
							break
						case "use_mcp_server":
							setTextAreaDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Approve")
							setSecondaryButtonText("Reject")
							break
						case "completion_result":
							playSoundOnMessage("celebration")
							setTextAreaDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							playSoundOnMessage("notification")
							setTextAreaDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							setPrimaryButtonText("Resume Task")
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
						case "resume_completed_task":
							playSoundOnMessage("celebration")
							setTextAreaDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
					}
					break
				case "say":
					switch (lastMessage.say) {
						case "api_req_started":
							if (secondLastMessage?.ask === "command_output") {
								setInputValue("")
								setTextAreaDisabled(true)
								setSelectedImages([])
								setClineAsk(undefined)
								setEnableButtons(false)
							}
							break
						case "task":
						case "error":
						case "api_req_finished":
						case "text":
						case "browser_action":
						case "browser_action_result":
						case "command_output":
						case "mcp_server_request_started":
						case "mcp_server_response":
						case "completion_result":
						case "tool":
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage, countdown])

	// Add this callback function near other useCallback declarations
	const toggleAutoAccept = useCallback(() => {
		setAutoAcceptEnabled(prev => {
			const newValue = !prev;
			vscode.postMessage({
				type: "setAutoAccept",
				value: newValue,
				threadId: task?.ts
			});
			return newValue;
		});
	}, [task?.ts]);

	useEffect(() => {
		if (messages.length === 0) {
			setTextAreaDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	useEffect(() => {
		setExpandedRows({})
	}, [task?.ts])

	const isStreaming = useMemo(() => {
		const isLastAsk = !!modifiedMessages.at(-1)?.ask // checking clineAsk isn't enough since messages effect may be called again for a tool for example, set clineAsk to its value, and if the next message is not an ask then it doesn't reset. This is likely due to how much more often we're updating messages as compared to before, and should be resolved with optimizations as it's likely a rendering bug. but as a final guard for now, the cancel button will show if the last message is not an ask
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
			if (lastApiReqStarted && lastApiReqStarted.text != null && lastApiReqStarted.say === "api_req_started") {
				const cost = JSON.parse(lastApiReqStarted.text).cost
				if (cost === undefined) {
					// api request has not finished yet
					return true
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

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
						case "command": // user can provide feedback to a tool or command use
						case "command_output": // user can send input to command stdin
						case "use_mcp_server":
						case "completion_result": // if this happens then the user has feedback for the completion result
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({
								type: "askResponse",
								askResponse: "messageResponse",
								text,
								images,
							})
							break
						// there is no other case that a textfield should be enabled
					}
				}
				setInputValue("")
				setTextAreaDisabled(true)
				setSelectedImages([])
				setClineAsk(undefined)
				setEnableButtons(false)
				// setPrimaryButtonText(undefined)
				// setSecondaryButtonText(undefined)
				disableAutoScrollRef.current = false
			}
		},
		[messages.length, clineAsk],
	)

	const startNewTask = useCallback(() => {
		vscode.postMessage({ type: "clearTask" })
	}, [])

	/*
	This logic depends on the useEffect[messages] above to set clineAsk, after which buttons are shown and we then send an askResponse to the extension.
	*/
	const handlePrimaryButtonClick = useCallback(() => {
		switch (clineAsk) {
			case "api_req_failed":
			case "command":
			case "command_output":
			case "tool":
			case "browser_action_launch":
			case "use_mcp_server":
			case "resume_task":
			case "mistake_limit_reached":
				vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
				break
			case "completion_result":
			case "resume_completed_task":
				// extension waiting for feedback. but we can just present a new task button
				startNewTask()
				break
		}
		setTextAreaDisabled(true)
		setClineAsk(undefined)
		setEnableButtons(false)
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
		disableAutoScrollRef.current = false
	}, [clineAsk, startNewTask])

	const handleSecondaryButtonClick = useCallback(() => {
		if (isStreaming) {
			vscode.postMessage({ type: "cancelTask" })
			setDidClickCancel(true)
			return
		}

		switch (clineAsk) {
			case "api_req_failed":
			case "mistake_limit_reached":
				startNewTask()
				break
			case "command":
			case "tool":
			case "browser_action_launch":
			case "use_mcp_server":
				// responds to the API with a "This operation failed" and lets it try again
				vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
				break
		}
		setTextAreaDisabled(true)
		setClineAsk(undefined)
		setEnableButtons(false)
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
		disableAutoScrollRef.current = false
	}, [clineAsk, startNewTask, isStreaming])

	// Add effect for countdown timer
	useEffect(() => {
		if (isStreaming) {
			// Set hasStarted to true once a request has started
			setHasStarted(true)
		}
		// Only execute when isStreaming changes from true to false
		if (wasStreaming && !isStreaming && lastMessage) {
			// Play appropriate sound based on lastMessage content
			if (lastMessage.type === "ask") {
				switch (lastMessage.ask) {
					case "api_req_failed":
					case "mistake_limit_reached":
						playSound("progress_loop")
						break
					case "tool":
					case "followup":
					case "browser_action_launch":
					case "resume_task":
						playSound("notification")
						break
					case "completion_result":
					case "resume_completed_task":
						playSound("celebration")
						break
				}
			}
		}
		// Update previous streaming state
		setWasStreaming(isStreaming)
	}, [isStreaming, lastMessage])

	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	const selectImages = useCallback(() => {
		vscode.postMessage({ type: "selectImages" })
	}, [])

	const shouldDisableImages =
		!selectedModelInfo.supportsImages || textAreaDisabled || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !textAreaDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
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
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							handlePrimaryButtonClick()
							break
						case "secondaryButtonClick":
							handleSecondaryButtonClick()
							break
					}
			}
			// textAreaRef.current is not explicitly required here since react gaurantees that ref will be stable across re-renders, and we're not using its value but its reference.
		},
		[
			isHidden,
			textAreaDisabled,
			enableButtons,
			handleSendMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
		],
	)

	useEvent("message", handleMessage)

	useMount(() => {
		// NOTE: the vscode window needs to be focused for this to work
		textAreaRef.current?.focus()
	})

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !textAreaDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, textAreaDisabled, enableButtons])

	const visibleMessages = useMemo(() => {
		return modifiedMessages.filter((message) => {
			switch (message.ask) {
				case "completion_result":
					// don't show a chat row for a completion_result ask without text. This specific type of message only occurs if cline wants to execute a command as part of its completion result, in which case we interject the completion_result tool with the execute_command tool.
					if (message.text === "") {
						return false
					}
					break
				case "api_req_failed": // this message is used to update the latest api_req_started that the request failed
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished": // combineApiRequests removes this from modifiedMessages anyways
				case "api_req_retried": // this message is used to update the latest api_req_started that the request was retried
					return false
				case "text":
					// Sometimes cline returns an empty text message, we don't want to render these. (We also use a say text for user messages, so in case they just sent images we still render that)
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

	const isBrowserSessionMessage = (message: ClineMessage): boolean => {
		// which of visible messages are browser session messages, see above
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
				// complete existing browser session if any
				endBrowserSession()
				// start new
				isInBrowserSession = true
				currentGroup.push(message)
			} else if (isInBrowserSession) {
				// end session if api_req_started is cancelled

				if (message.say === "api_req_started") {
					// get last api_req_started in currentGroup to check if it's cancelled. If it is then this api req is not part of the current browser session
					const lastApiReqStarted = [...currentGroup].reverse().find((m) => m.say === "api_req_started")
					if (lastApiReqStarted?.text != null) {
						const info = JSON.parse(lastApiReqStarted.text)
						const isCancelled = info.cancelReason != null
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
			debounce(
				() => {
					virtuosoRef.current?.scrollTo({
						top: Number.MAX_SAFE_INTEGER,
						behavior: "smooth",
					})
				},
				10,
				{ immediate: true },
			),
		[],
	)

	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // instant causes crash
		})
	}, [])

	// scroll when user toggles certain rows
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

			setExpandedRows((prev) => ({
				...prev,
				[ts]: !prev[ts],
			}))

			// disable auto scroll when user expands row
			if (!isCollapsing) {
				disableAutoScrollRef.current = true
			}

			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			} else if (isLast || isSecondToLast) {
				if (isCollapsing) {
					if (isSecondToLast && !isLastCollapsedApiReq) {
						return
					}
					const timer = setTimeout(() => {
						scrollToBottomAuto()
					}, 0)
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
					setTimeout(() => {
						scrollToBottomAuto()
					}, 0)
				}
			}
		},
		[scrollToBottomSmooth, scrollToBottomAuto],
	)

	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			setTimeout(() => {
				scrollToBottomSmooth()
			}, 50)
			// return () => clearTimeout(timer) // dont cleanup since if visibleMessages.length changes it cancels.
		}
	}, [groupedMessages.length, scrollToBottomSmooth])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	const placeholderText = useMemo(() => {
		const text = task ? "Type a message (@ to add context)..." : "Type your task here (@ to add context)..."
		return text
	}, [task])

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
				/>
			)
		},
		[expandedRows, modifiedMessages, groupedMessages.length, toggleRowExpansion, handleRowHeightChange],
	)

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: isHidden ? "none" : "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
            {task ? (
                <TaskHeader
                    task={task}
                    tokensIn={apiMetrics.totalTokensIn}
                    tokensOut={apiMetrics.totalTokensOut}
                    doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
                    cacheWrites={apiMetrics.totalCacheWrites}
                    cacheReads={apiMetrics.totalCacheReads}
                    totalCost={apiMetrics.totalCost}
                    onClose={handleTaskCloseButtonClick}
                    autoAcceptEnabled={autoAcceptEnabled}
                    onAutoAcceptToggle={toggleAutoAccept}
                />
            ) : (
                <div
                    style={{
                        flexGrow: 1,
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                    }}>
                    {showAnnouncement && <Announcement version={version} hideAnnouncement={hideAnnouncement} />}
                    <div style={{ padding: "0 20px", flexShrink: 0 }}>
                        <h2>What can I do for you?</h2>
                        <p>
                            Thanks to{" "}
                            <VSCodeLink
                                href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
                                style={{ display: "inline" }}>
                                Claude 3.5 Sonnet's agentic coding capabilities,
                            </VSCodeLink>{" "}
                            I can handle complex software development tasks step-by-step. With tools that let me create
                            & edit files, explore complex projects, use the browser, and execute terminal commands
                            (after you grant permission), I can assist you in ways that go beyond code completion or
							tech support. I can even use MCP to create new tools and extend my own capabilities.
                        </p>
                    </div>
                    {taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
                </div>
            )}
            {task && (
                <>
                    <div style={{ flexGrow: 1, display: "flex" }} ref={scrollContainerRef}>
                        <Virtuoso
                            ref={virtuosoRef}
                            key={task.ts}
                            className="scrollable"
                            style={{
                                flexGrow: 1,
                                overflowY: "scroll",
                            }}
                            components={{
                                Footer: () => <div style={{ height: 5 }} />,
                            }}
                            increaseViewportBy={{ top: 3_000, bottom: Number.MAX_SAFE_INTEGER }}
                            data={groupedMessages}
                            itemContent={itemContent}
                            atBottomStateChange={(isAtBottom) => {
                                setIsAtBottom(isAtBottom)
                                if (isAtBottom) {
                                    disableAutoScrollRef.current = false
                                }
                                setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
                            }}
                            atBottomThreshold={10}
                            initialTopMostItemIndex={groupedMessages.length - 1}
                        />
                    </div>
                    {showScrollToBottom ? (
                        <div
                            style={{
                                display: "flex",
                                padding: "10px 15px 0px 15px",
                            }}>
                            <ScrollToBottomButton
                                onClick={() => {
                                    scrollToBottomSmooth()
                                    disableAutoScrollRef.current = false
                                }}>
                                <span className="codicon codicon-chevron-down" style={{ fontSize: "18px" }}></span>
                            </ScrollToBottomButton>
                        </div>
                    ) : (
                        <div
                            style={{
                                opacity:
                                    primaryButtonText || secondaryButtonText || isStreaming
                                        ? enableButtons || (isStreaming && !didClickCancel)
                                            ? 1
                                            : 0.5
                                        : 0,
                                display: "flex",
                                padding: "10px 15px 0px 15px",
                            }}>
                            {primaryButtonText && !isStreaming && (
                                <VSCodeButton
                                    appearance="primary"
                                    disabled={!enableButtons}
                                    style={{
                                        flex: secondaryButtonText ? 1 : 2,
                                        marginRight: secondaryButtonText ? "6px" : "0",
                                    }}
                                    onClick={handlePrimaryButtonClick}>
                                    {primaryButtonText}
                                </VSCodeButton>
                            )}
                            {(secondaryButtonText || isStreaming) && (
                                <VSCodeButton
                                    appearance="secondary"
                                    disabled={!enableButtons && !(isStreaming && !didClickCancel)}
                                    style={{
                                        flex: isStreaming ? 2 : 1,
                                        marginLeft: isStreaming ? 0 : "6px",
                                    }}
                                    onClick={handleSecondaryButtonClick}>
                                    {isStreaming ? "Cancel" : secondaryButtonText}
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
                textAreaDisabled={textAreaDisabled}
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
            />
			
		</div>
	)
}

const ScrollToBottomButton = styled.div`
	background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 55%, transparent);
	border-radius: 3px;
	overflow: hidden;
	cursor: pointer;
	display: flex;
	justify-content: center;
	align-items: center;
	flex: 1;
	height: 25px;

	&:hover {
		background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 90%, transparent);
	}

	&:active {
		background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 70%, transparent);
	}
`

export default ChatView
