import { ClaudeAsk, ClaudeMessage, ExtensionMessage } from "@shared/ExtensionMessage"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { vscode } from "../utilities/vscode"
import ChatRow from "./ChatRow"
import { combineCommandSequences } from "../utilities/combineCommandSequences"
import { combineApiRequests } from "../utilities/combineApiRequests"
import TaskHeader from "./TaskHeader"
import { getApiMetrics } from "../utilities/getApiMetrics"
import { animateScroll as scroll } from "react-scroll"

interface ChatViewProps {
	messages: ClaudeMessage[]
	isHidden: boolean
	onMessagesUpdate: (messages: ClaudeMessage[]) => void
}

const ChatView: React.FC<ChatViewProps> = ({ messages, isHidden, onMessagesUpdate }) => {
	const task = messages.length > 0 ? messages[0] : undefined
	const modifiedMessages = useMemo(() => {
		const processedMessages = combineApiRequests(combineCommandSequences(messages.slice(1)))
		return processedMessages.map((message) => ({
			...message,
			type: message.type || (message.say ? "say" : "ask"),
			say: message.say,
			ask: message.ask,
		}))
	}, [messages])

	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaHeight, setTextAreaHeight] = useState<number | undefined>(undefined)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)

	const [claudeAsk, setClaudeAsk] = useState<ClaudeAsk | undefined>(undefined)

	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)

	const scrollToBottom = (instant: boolean = false) => {
		const options = {
			containerId: "chat-view-container",
			duration: instant ? 0 : 500,
			smooth: instant ? false : "easeOutQuint",
		}
		scroll.scrollToBottom(options)
	}

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
		const lastMessage = messages.at(-1)
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					switch (lastMessage.ask) {
						case "request_limit_reached":
							setTextAreaDisabled(true)
							setClaudeAsk("request_limit_reached")
							setPrimaryButtonText("Proceed")
							setSecondaryButtonText("Start New Task")
							break
						case "followup":
							setTextAreaDisabled(false)
							setClaudeAsk("followup")
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "tool":
							setTextAreaDisabled(true)
							setClaudeAsk("tool")
							setPrimaryButtonText("Approve")
							setSecondaryButtonText("Cancel")
							break
						case "command":
							setTextAreaDisabled(true)
							setClaudeAsk("command")
							setPrimaryButtonText("Run Command")
							setSecondaryButtonText("Cancel")
							break
						case "completion_result":
							setTextAreaDisabled(false)
							setClaudeAsk("completion_result")
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							break
					}
					break
				case "say":
					switch (lastMessage.say) {
						case "task":
						case "error":
						case "api_req_started":
						case "api_req_finished":
						case "text":
						case "command_output":
						case "completion_result":
							break
					}
					break
			}
		}
	}, [messages])

	useEffect(() => {
		if (messages.length === 0) {
			setTextAreaDisabled(false)
			setClaudeAsk(undefined)
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
					case "completion_result":
						vscode.postMessage({ type: "askResponse", askResponse: "textResponse", text })
						break
				}
			}
			setInputValue("")
			setTextAreaDisabled(true)
			setClaudeAsk(undefined)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}

	const handlePrimaryButtonClick = () => {
		switch (claudeAsk) {
			case "request_limit_reached":
			case "command":
			case "tool":
				vscode.postMessage({ type: "askResponse", askResponse: "yesButtonTapped" })
				break
			case "completion_result":
				startNewTask()
				break
		}
		setTextAreaDisabled(true)
		setClaudeAsk(undefined)
		setPrimaryButtonText(undefined)
		setSecondaryButtonText(undefined)
	}

	const handleSecondaryButtonClick = () => {
		switch (claudeAsk) {
			case "request_limit_reached":
			case "tool":
				startNewTask()
				break
			case "command":
				vscode.postMessage({ type: "askResponse", askResponse: "noButtonTapped" })
				break
		}
		setTextAreaDisabled(true)
		setClaudeAsk(undefined)
		setPrimaryButtonText(undefined)
		setSecondaryButtonText(undefined)
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
		if (textAreaRef.current && !textAreaHeight) {
			setTextAreaHeight(textAreaRef.current.offsetHeight)
		}

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
	}, [textAreaHeight])

	useEffect(() => {
		if (!isHidden && !textAreaDisabled) {
			textAreaRef.current?.focus()
		}
	}, [isHidden, textAreaDisabled])

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
					overflowY: "auto",
				}}>
				{visibleMessages.map((message, index) => (
					<ChatRow key={index} message={message} />
				))}
			</div>
			{(primaryButtonText || secondaryButtonText) && (
				<div style={{ display: "flex", padding: "10px 15px 0px 15px" }}>
					{primaryButtonText && (
						<VSCodeButton
							appearance="primary"
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
							style={{ flex: 1, marginLeft: "6px" }}
							onClick={handleSecondaryButtonClick}>
							{secondaryButtonText}
						</VSCodeButton>
					)}
				</div>
			)}
			<div style={{ padding: "10px 15px", opacity: textAreaDisabled ? 0.7 : 1, position: "relative" }}>
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
						borderRadius: "2px",
						fontFamily: "var(--vscode-font-family)",
						fontSize: "var(--vscode-editor-font-size)",
						lineHeight: "var(--vscode-editor-line-height)",
						resize: "none",
						overflow: "hidden",
						padding: "8px 36px 8px 8px",
					}}
				/>
				<div
					style={{
						position: "absolute",
						right: "20px",
						top: "0px",
						bottom: "1.5px",
						display: "flex",
						alignItems: "center",
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
