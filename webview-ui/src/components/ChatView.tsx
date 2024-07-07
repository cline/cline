import { ExtensionMessage } from "@shared/ExtensionMessage"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { KeyboardEvent, useEffect, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { vscode } from "../utilities/vscode"

interface Message {
	id: string
	text: string
	sender: "user" | "assistant"
}

const ChatView = () => {
	const [messages, setMessages] = useState<Message[]>([])
	const [inputValue, setInputValue] = useState("")
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaHeight, setTextAreaHeight] = useState<number | undefined>(undefined)

	const scrollToBottom = () => {
		// https://stackoverflow.com/questions/11039885/scrollintoview-causing-the-whole-page-to-move
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: 'nearest', inline: 'start' })
	}

	useEffect(scrollToBottom, [messages])

	const handleSendMessage = () => {
		if (inputValue.trim()) {
			const newMessage: Message = {
				id: `${Date.now()}-user`,
				text: inputValue.trim(),
				sender: "user",
			}
			setMessages(currentMessages => [...currentMessages, newMessage])
			setInputValue("")
			// Here you would typically send the message to your extension's backend
			vscode.postMessage({ type: "text", text: newMessage.text})
		}
	}
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

		window.addEventListener("message", (e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			if (message.type === "text") {
				const newMessage: Message = {
					id: `${Date.now()}-assistant`,
					text: message.text!.trim(),
					sender: "assistant",
				}
				setMessages(currentMessages => [...currentMessages, newMessage])
			}
		})
	}, [])

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
			<div style={{ flexGrow: 1, overflowY: "scroll", scrollbarWidth: "none" }}>
				{messages.map((message) => (
					<div
						key={message.id}
						style={{
							marginBottom: "10px",
							padding: "8px",
							borderRadius: "4px",
							backgroundColor:
								message.sender === "user"
									? "var(--vscode-editor-background)"
									: "var(--vscode-sideBar-background)",
						}}>
						<span style={{ whiteSpace: "pre-line", overflowWrap: "break-word" }}>{message.text}</span>
					</div>
				))}
				<div style={{ float:"left", clear: "both" }} ref={messagesEndRef} />
			</div>
			<div style={{ position: "relative", paddingTop: "16px", paddingBottom: "16px" }}>
				<DynamicTextArea
					ref={textAreaRef}
					value={inputValue}
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
