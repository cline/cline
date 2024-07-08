import { ClaudeAsk, ClaudeMessage, ExtensionMessage } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { vscode } from "../utilities/vscode"
import { ClaudeAskResponse } from "@shared/WebviewMessage"
import ChatRow from "./ChatRow"
import { combineCommandSequences } from "../utilities/combineCommandSequences"
import { combineApiRequests } from "../utilities/combineApiRequests"

interface ChatViewProps {
	messages: ClaudeMessage[]
}
// maybe instead of storing state in App, just make chatview  always show so dont conditionally load/unload? need to make sure messages are persisted (i remember seeing something about how webviews can be frozen in docs)
const ChatView = ({}: ChatViewProps) => {
	// dummy data for messages
	const generateRandomTimestamp = (baseDate: Date, rangeInDays: number): number => {
		const rangeInMs = rangeInDays * 24 * 60 * 60 * 1000 // convert days to milliseconds
		const randomOffset = Math.floor(Math.random() * rangeInMs * 2) - rangeInMs // rangeInMs * 2 to have offset in both directions
		return baseDate.getTime() + randomOffset
	}

	const baseDate = new Date("2024-07-08T00:00:00Z")

	const messages: ClaudeMessage[] = [
		{ type: "say", say: "task", text: "Starting task", ts: generateRandomTimestamp(baseDate, 1) },
		{
			type: "ask",
			ask: "request_limit_reached",
			text: "Request limit reached",
			ts: generateRandomTimestamp(baseDate, 2),
		},
		{ type: "ask", ask: "followup", text: "Any additional questions?", ts: generateRandomTimestamp(baseDate, 3) },
		{ type: "say", say: "error", text: "An error occurred", ts: generateRandomTimestamp(baseDate, 4) },

		{ type: "say", say: "text", text: "Some general text", ts: generateRandomTimestamp(baseDate, 7) },
		{ type: "say", say: "tool", text: "Using a tool", ts: generateRandomTimestamp(baseDate, 8) },

		// First command sequence
		{ type: "ask", ask: "command", text: "ls -l", ts: generateRandomTimestamp(baseDate, 9) },
		{ type: "say", say: "command_output", text: "file1.txt", ts: generateRandomTimestamp(baseDate, 10) },
		{ type: "say", say: "api_req_started", text: JSON.stringify({ request: "GET /api/data" }), ts: generateRandomTimestamp(baseDate, 5) },
		{ type: "say", say: "command_output", text: "file2.txt", ts: generateRandomTimestamp(baseDate, 11) },
		{ type: "say", say: "command_output", text: "directory1", ts: generateRandomTimestamp(baseDate, 12) },

		{ type: "say", say: "text", text: "Interrupting text", ts: generateRandomTimestamp(baseDate, 13) },
		{ type: "say", say: "api_req_finished", text: JSON.stringify({ cost: "GET /api/data" }), ts: generateRandomTimestamp(baseDate, 6) },
		// Second command sequence
		{ type: "ask", ask: "command", text: "pwd", ts: generateRandomTimestamp(baseDate, 14) },
		{ type: "say", say: "command_output", text: "/home/user", ts: generateRandomTimestamp(baseDate, 15) },

		{ type: "ask", ask: "completion_result", text: "Task completed", ts: generateRandomTimestamp(baseDate, 16) },

		// Third command sequence (no output)
		{ type: "ask", ask: "command", text: "echo Hello", ts: generateRandomTimestamp(baseDate, 17) },

		// Testing combineApiRequests
		{ type: "say", say: "text", text: "Final message", ts: generateRandomTimestamp(baseDate, 18) },
		{ type: "ask", ask: "command", text: "ls -l", ts: generateRandomTimestamp(baseDate, 19) },
		{ type: "say", say: "command_output", text: "file1.txt", ts: generateRandomTimestamp(baseDate, 20) },
		{
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "GET /api/data" }),
			ts: generateRandomTimestamp(baseDate, 23),
		},
		{ type: "say", say: "command_output", text: "file2.txt", ts: generateRandomTimestamp(baseDate, 24) },
		{ type: "say", say: "text", text: "Some random text", ts: generateRandomTimestamp(baseDate, 25) },
		{
			type: "say",
			say: "api_req_finished",
			text: JSON.stringify({ cost: 0.005 }),
			ts: generateRandomTimestamp(baseDate, 26),
		},
		{ type: "ask", ask: "command", text: "pwd", ts: generateRandomTimestamp(baseDate, 27) },
		{ type: "say", say: "command_output", text: "/home/user", ts: generateRandomTimestamp(baseDate, 28) },
		{
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "POST /api/update" }),
			ts: generateRandomTimestamp(baseDate, 29),
		},
		{ type: "say", say: "text", text: "Final message", ts: generateRandomTimestamp(baseDate, 30) },
	]

	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages)), [messages])

	const [inputValue, setInputValue] = useState("")
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaHeight, setTextAreaHeight] = useState<number | undefined>(undefined)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)

	const [claudeAsk, setClaudeAsk] = useState<ClaudeAsk | undefined>(undefined)

	const scrollToBottom = () => {
		// https://stackoverflow.com/questions/11039885/scrollintoview-causing-the-whole-page-to-move
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" })
	}

	useEffect(() => {
		scrollToBottom()
		// if last message is an ask, show user ask UI

		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted

		const lastMessage = messages.at(-1)
		if (lastMessage) {
			if (lastMessage.type === "ask") {
				setClaudeAsk(lastMessage.ask)
				//setTextAreaDisabled(false) // should enable for certain asks
			} else {
				setClaudeAsk(undefined)
				//setTextAreaDisabled(true)
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

	useEffect(() => {
		if (textAreaRef.current && !textAreaHeight) {
			setTextAreaHeight(textAreaRef.current.offsetHeight)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				overflow: "hidden",
				backgroundColor: "gray",
			}}>
			<div style={{ flexGrow: 1, overflowY: "scroll", scrollbarWidth: "none" }}>
				{modifiedMessages.map((message) => (
					<ChatRow message={message} />
				))}
				<div style={{ float: "left", clear: "both" }} ref={messagesEndRef} />
			</div>
			<div style={{ position: "relative", paddingTop: "16px", paddingBottom: "16px" }}>
				<DynamicTextArea
					ref={textAreaRef}
					value={inputValue}
					disabled={textAreaDisabled}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onHeightChange={() => scrollToBottom()}
					placeholder="Type a message..."
					maxRows={10}
					style={{
						width: "100%",
						boxSizing: "border-box",
						backgroundColor: "var(--vscode-input-background, #3c3c3c)",
						color: "var(--vscode-input-foreground, #cccccc)",
						border: "1px solid var(--vscode-input-border, #3c3c3c)",
						borderRadius: "2px",
						fontFamily:
							"var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif)",
						fontSize: "var(--vscode-editor-font-size, 13px)",
						lineHeight: "var(--vscode-editor-line-height, 1.5)",
						resize: "none",
						overflow: "hidden",
						paddingTop: "8px",
						paddingBottom: "8px",
						paddingLeft: "8px",
						paddingRight: "40px", // Make room for button
					}}
				/>
				{textAreaHeight && (
					<div
						style={{
							position: "absolute",
							right: "12px",
							height: `${textAreaHeight}px`,
							bottom: "18px",
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
