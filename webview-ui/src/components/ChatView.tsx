import { ClaudeAsk, ClaudeMessage, ExtensionMessage } from "@shared/ExtensionMessage"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { animateScroll as scroll } from "react-scroll"
import DynamicTextArea from "react-textarea-autosize"
import { combineApiRequests } from "../utilities/combineApiRequests"
import { combineCommandSequences } from "../utilities/combineCommandSequences"
import { getApiMetrics } from "../utilities/getApiMetrics"
import { vscode } from "../utilities/vscode"
import ChatRow from "./ChatRow"
import TaskHeader from "./TaskHeader"
import { getSyntaxHighlighterStyleFromTheme } from "../utilities/getSyntaxHighlighterStyleFromTheme"
import vsDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus"

interface ChatViewProps {
	messages: ClaudeMessage[]
	isHidden: boolean
	vscodeThemeName?: string
}
// maybe instead of storing state in App, just make chatview  always show so dont conditionally load/unload? need to make sure messages are persisted (i remember seeing something about how webviews can be frozen in docs)
const ChatView = ({ messages, isHidden, vscodeThemeName }: ChatViewProps) => {
	//const task = messages.length > 0 ? (messages[0].say === "task" ? messages[0] : undefined) : undefined
	const task = messages.length > 0 ? messages[0] : undefined // leaving this less safe version here since if the first message is not a task, then the extension is in a bad state and needs to be debugged (see ClaudeDev.abort)
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	// has to be after api_req_finished are all reduced into api_req_started messages
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaHeight, setTextAreaHeight] = useState<number | undefined>(undefined)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)

	// we need to hold on to the ask because useEffect > lastMessage will always let us know when an ask comes in and handle it, but by the time handleMessage is called, the last message might not be the ask anymore (it could be a say that followed)
	const [claudeAsk, setClaudeAsk] = useState<ClaudeAsk | undefined>(undefined)

	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)

	const [syntaxHighlighterStyle, setSyntaxHighlighterStyle] = useState(vsDarkPlus)

	useEffect(() => {
		if (!vscodeThemeName) return
		const theme = getSyntaxHighlighterStyleFromTheme(vscodeThemeName)
		if (theme) {
			setSyntaxHighlighterStyle(theme)
		}
	}, [vscodeThemeName])

	const scrollToBottom = (instant: boolean = false) => {
		const options = {
			containerId: "chat-view-container",
			duration: instant ? 0 : 500,
			smooth: instant ? false : "easeOutQuint",
		}
		scroll.scrollToBottom(options)
	}

	// scroll to bottom when new message is added
	const visibleMessages = useMemo(
		() =>
			modifiedMessages.filter(
				(message) => !(message.type === "ask" && message.ask === "completion_result" && message.text === "")
			),
		[modifiedMessages]
	)
	useEffect(() => {
		const timer = setTimeout(() => {
			scrollToBottom()
		}, 0)
		return () => {
			clearTimeout(timer)
		}
	}, [visibleMessages])

	useEffect(() => {
		// if last message is an ask, show user ask UI

		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted

		const lastMessage = messages.at(-1)
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					switch (lastMessage.ask) {
						case "request_limit_reached":
							setTextAreaDisabled(true)
							setClaudeAsk("request_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText("Proceed")
							setSecondaryButtonText("Start New Task")
							break
						case "followup":
							setTextAreaDisabled(false)
							setClaudeAsk("followup")
							setEnableButtons(false)
							// setPrimaryButtonText(undefined)
							// setSecondaryButtonText(undefined)
							break
						case "tool":
							setTextAreaDisabled(true)
							setClaudeAsk("tool")
							setEnableButtons(true)
							setPrimaryButtonText("Approve")
							setSecondaryButtonText("Cancel")
							break
						case "command":
							setTextAreaDisabled(true)
							setClaudeAsk("command")
							setEnableButtons(true)
							setPrimaryButtonText("Run Command")
							setSecondaryButtonText("Cancel")
							break
						case "completion_result":
							// extension waiting for feedback. but we can just present a new task button
							setTextAreaDisabled(false)
							setClaudeAsk("completion_result")
							setEnableButtons(true)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							break
					}
					break
				case "say":
					// don't want to reset since there could be a "say" after an "ask" while ask is waiting for response
					switch (lastMessage.say) {
						case "task":
							break
						case "error":
							break
						case "api_req_started":
							break
						case "api_req_finished":
							break
						case "text":
							break
						case "command_output":
							break
						case "completion_result":
							break
					}
					break
			}
		} else {
			// this would get called after sending the first message, so we have to watch messages.length instead
			// No messages, so user has to submit a task
			// setTextAreaDisabled(false)
			// setClaudeAsk(undefined)
			// setPrimaryButtonText(undefined)
			// setSecondaryButtonText(undefined)
		}
	}, [messages])

	useEffect(() => {
		if (messages.length === 0) {
			setTextAreaDisabled(false)
			setClaudeAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	const handleSendMessage = () => {
		const text = inputValue.trim()
		if (text) {
			if (messages.length === 0) {
				vscode.postMessage({ type: "newTask", text })
			} else if (claudeAsk) {
				switch (claudeAsk) {
					case "followup":
					case "completion_result": // if this happens then the user has feedback for the completion result
						vscode.postMessage({ type: "askResponse", askResponse: "textResponse", text })
						break
					// there is no other case that a textfield should be enabled
				}
			}
			setInputValue("")
			setTextAreaDisabled(true)
			setClaudeAsk(undefined)
			setEnableButtons(false)
			// setPrimaryButtonText(undefined)
			// setSecondaryButtonText(undefined)
		}
	}

	/*
	This logic depends on the useEffect[messages] above to set claudeAsk, after which buttons are shown and we then send an askResponse to the extension.
	*/
	const handlePrimaryButtonClick = () => {
		switch (claudeAsk) {
			case "request_limit_reached":
			case "command":
			case "tool":
				vscode.postMessage({ type: "askResponse", askResponse: "yesButtonTapped" })
				break
			case "completion_result":
				// extension waiting for feedback. but we can just present a new task button
				startNewTask()
				break
		}
		setTextAreaDisabled(true)
		setClaudeAsk(undefined)
		setEnableButtons(false)
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}

	const handleSecondaryButtonClick = () => {
		switch (claudeAsk) {
			case "request_limit_reached":
			case "tool": // TODO: for now when a user cancels, it starts a new task. But we could easily just respond to the API with a "This operation failed" and let it try again.
				startNewTask()
				break
			case "command":
				vscode.postMessage({ type: "askResponse", askResponse: "noButtonTapped" })
				break
		}
		setTextAreaDisabled(true)
		setClaudeAsk(undefined)
		setEnableButtons(false)
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault()
			handleSendMessage()
		}
	}

	const handleTaskCloseButtonClick = () => {
		startNewTask()
	}

	const startNewTask = () => {
		vscode.postMessage({ type: "clearTask" })
	}

	useEffect(() => {
		const handleMessage = (e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							textAreaRef.current?.focus()
							break
					}
					break
			}
		}

		window.addEventListener("message", handleMessage)

		const timer = setTimeout(() => {
			textAreaRef.current?.focus()
		}, 20)
		return () => {
			clearTimeout(timer)
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	useEffect(() => {
		if (textAreaRef.current && !textAreaHeight) {
			setTextAreaHeight(textAreaRef.current.offsetHeight)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [textAreaRef.current])

	useEffect(() => {
		if (!isHidden && !textAreaDisabled) {
			textAreaRef.current?.focus()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isHidden])

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!textAreaDisabled) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [textAreaDisabled])

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
					taskText={task.text || ""}
					tokensIn={apiMetrics.totalTokensIn}
					tokensOut={apiMetrics.totalTokensOut}
					totalCost={apiMetrics.totalCost}
					onClose={handleTaskCloseButtonClick}
				/>
			) : (
				<div style={{ padding: "0 25px" }}>
					<h2>What can I do for you?</h2>
					<p>
						Thanks to{" "}
						<VSCodeLink
							href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
							style={{ display: "inline" }}>
							Claude 3.5 Sonnet's agentic coding capabilities,
						</VSCodeLink>{" "}
						I can handle complex software development tasks step-by-step. With tools that let me read &
						write files, create entire projects from scratch, and execute terminal commands (after you grant
						permission), I can assist you in ways that go beyond simple code completion or tech support.
					</p>
				</div>
			)}
			<div
				id="chat-view-container"
				className="scrollable"
				style={{
					flexGrow: 1,
					overflowY: "scroll",
					padding: "0 6px 0 15px",
				}}>
				{modifiedMessages.map((message, index) => (
					<ChatRow key={index} message={message} syntaxHighlighterStyle={syntaxHighlighterStyle} />
				))}
			</div>
			<div
				style={{
					opacity: primaryButtonText || secondaryButtonText ? (enableButtons ? 1 : 0.5) : 0,
					display: "flex",
					padding: "10px 15px 0px 15px",
				}}>
				{primaryButtonText && (
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
				{secondaryButtonText && (
					<VSCodeButton
						appearance="secondary"
						disabled={!enableButtons}
						style={{ flex: 1, marginLeft: "6px" }}
						onClick={handleSecondaryButtonClick}>
						{secondaryButtonText}
					</VSCodeButton>
				)}
			</div>
			<div style={{ padding: "10px 15px", opacity: textAreaDisabled ? 0.5 : 1, position: "relative" }}>
				<DynamicTextArea
					ref={textAreaRef}
					value={inputValue}
					disabled={textAreaDisabled}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onHeightChange={() => scrollToBottom(true)}
					placeholder={task ? "Type a message..." : "Type your task here..."}
					maxRows={10}
					autoFocus={true}
					style={{
						width: "100%",
						boxSizing: "border-box",
						backgroundColor: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						border: "1px solid var(--vscode-input-border)",
						borderRadius: 2,
						fontFamily: "var(--vscode-font-family)",
						fontSize: "var(--vscode-editor-font-size)",
						lineHeight: "var(--vscode-editor-line-height)",
						resize: "none",
						overflow: "hidden",
						padding: "8px 36px 8px 8px",
						cursor: textAreaDisabled ? "not-allowed" : undefined,
					}}
				/>
				<div
					style={{
						position: "absolute",
						right: 20,
						display: "flex",
						alignItems: "center",
						...(!!textAreaHeight ? { height: textAreaHeight, bottom: 12 } : { top: 0, bottom: 1.5 }),
					}}>
					<VSCodeButton
						disabled={textAreaDisabled}
						appearance="icon"
						aria-label="Send Message"
						onClick={handleSendMessage}>
						<span className="codicon codicon-send"></span>
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default ChatView
