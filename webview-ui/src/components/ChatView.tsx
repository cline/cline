import { ClaudeAsk, ClaudeMessage, ExtensionMessage } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { vscode } from "../utilities/vscode"
import { ClaudeAskResponse } from "@shared/WebviewMessage"
import ChatRow from "./ChatRow"
import { combineCommandSequences } from "../utilities/combineCommandSequences"
import { combineApiRequests } from "../utilities/combineApiRequests"
import TaskHeader from "./TaskHeader"
import { getApiMetrics } from "../utilities/getApiMetrics"

interface ChatViewProps {
	messages: ClaudeMessage[]
}
// maybe instead of storing state in App, just make chatview  always show so dont conditionally load/unload? need to make sure messages are persisted (i remember seeing something about how webviews can be frozen in docs)
const ChatView = ({ messages }: ChatViewProps) => {
	const task = messages.shift()
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages)), [messages])
	// has to be after api_req_finished are all reduced into api_req_started messages
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaHeight, setTextAreaHeight] = useState<number | undefined>(undefined)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)

	const [claudeAsk, setClaudeAsk] = useState<ClaudeAsk | undefined>(undefined)

	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)

	const scrollToBottom = (instant: boolean = false) => {
		// https://stackoverflow.com/questions/11039885/scrollintoview-causing-the-whole-page-to-move
		;(messagesEndRef.current as any)?.scrollIntoView({
			behavior: instant ? "instant" : "smooth",
			block: "nearest",
			inline: "start",
		})
	}

	const handlePrimaryButtonClick = () => {
		//vscode.postMessage({ type: "askResponse", askResponse: "primaryButton" })
		setPrimaryButtonText(undefined)
		setSecondaryButtonText(undefined)
	}

	// New function to handle secondary button click
	const handleSecondaryButtonClick = () => {
		//vscode.postMessage({ type: "askResponse", askResponse: "secondaryButton" })
		setPrimaryButtonText(undefined)
		setSecondaryButtonText(undefined)
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
		scrollToBottom()
	}, [visibleMessages.length])

	useEffect(() => {
		// if last message is an ask, show user ask UI

		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted

		const lastMessage = messages.at(-1)
		if (lastMessage) {
			if (lastMessage.type === "ask") {
				//setTextAreaDisabled(false) // should enable for certain asks
				setClaudeAsk(lastMessage.ask)
				// Set button texts based on the ask
				// setPrimaryButtonText(lastMessage.ask === "command" ? "Yes" : "Continue")
				// setSecondaryButtonText(lastMessage.ask === "yesno" ? "No" : undefined)
				setPrimaryButtonText("Yes")
				setSecondaryButtonText("No")
			} else {
				//setTextAreaDisabled(true)
				setClaudeAsk(undefined)
				// setPrimaryButtonText(undefined)
				// setSecondaryButtonText(undefined)
				setPrimaryButtonText("Yes")
				setSecondaryButtonText("No")
			}
		}
	}, [messages])

	const handleSendMessage = () => {
		const text = inputValue.trim()
		if (text) {
			setInputValue("")
			if (messages.length === 0) {
				vscode.postMessage({ type: "newTask", text })
			} else if (claudeAsk) {
				switch (claudeAsk) {
					case "followup":
						vscode.postMessage({ type: "askResponse", askResponse: "textResponse", text })
						break
					// case "completion_result":
					// 	vscode.postMessage({ type: "askResponse", text })
					// 	break
					default:
						// for now we'll type the askResponses
						vscode.postMessage({ type: "askResponse", askResponse: text as ClaudeAskResponse })
						break
				}
			}
		}
	}

	// handle ask buttons
	// be sure to setInputValue("")

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault()
			handleSendMessage()
		}
	}

	const handleTaskCloseButtonClick = () => {
		vscode.postMessage({ type: "abortTask" })
	}

	useEffect(() => {
		if (textAreaRef.current && !textAreaHeight) {
			setTextAreaHeight(textAreaRef.current.offsetHeight)
			//textAreaRef.current.focus()
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			<TaskHeader
				taskText={task?.text || ""}
				tokensIn={apiMetrics.totalTokensIn}
				tokensOut={apiMetrics.totalTokensOut}
				totalCost={apiMetrics.totalCost}
				onClose={handleTaskCloseButtonClick}
			/>
			<div
				className="scrollable"
				style={{
					flexGrow: 1,
					overflowY: "auto",
				}}>
				{modifiedMessages.map((message, index) => (
					<ChatRow key={index} message={message} />
				))}
				<div style={{ float: "left", clear: "both" }} ref={messagesEndRef} />
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
			<div style={{ padding: "10px 15px" }}>
				<DynamicTextArea
					ref={textAreaRef}
					value={inputValue}
					disabled={textAreaDisabled}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onHeightChange={() => scrollToBottom(true)}
					placeholder="Type a message..."
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
						padding: "8px 40px 8px 8px",
					}}
				/>
				{textAreaHeight && (
					<div
						style={{
							position: "absolute",
							right: "18px",
							height: `${textAreaHeight}px`,
							bottom: "12px",
							display: "flex",
							alignItems: "center",
						}}>
						<VSCodeButton appearance="icon" aria-label="Send Message" onClick={handleSendMessage}>
							<span className="codicon codicon-send"></span>
						</VSCodeButton>
					</div>
				)}
			</div>
		</div>
	)
}

export default ChatView
