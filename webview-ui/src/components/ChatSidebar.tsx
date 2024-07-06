import React, { useState, useRef, useEffect, useCallback } from "react"
import { VSCodeButton, VSCodeTextArea, VSCodeDivider, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../utilities/vscode"
import ResizingTextArea from "./ResizingTextArea"

interface Message {
	id: number
	text: string
	sender: "user" | "assistant"
}

const ChatSidebar = () => {
	const [messages, setMessages] = useState<Message[]>([])
	const [inputValue, setInputValue] = useState("")
	const messagesEndRef = useRef<HTMLDivElement>(null)

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}

	useEffect(scrollToBottom, [messages])

	const handleSendMessage = () => {
		if (inputValue.trim()) {
			const newMessage: Message = {
				id: Date.now(),
				text: inputValue.trim(),
				sender: "user",
			}
			setMessages([...messages, newMessage])
			setInputValue("")
			// if (textAreaRef.current) {
			// 	textAreaRef.current.style.height = "auto"
			// }

			// Here you would typically send the message to your extension's backend
			vscode.postMessage({
				command: "sendMessage",
				text: newMessage.text,
			})
		}
	}

	return (
		<div className="chat-sidebar" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
			<div className="message-list" style={{ flexGrow: 1, overflowY: "auto", padding: "10px" }}>
				{messages.map((message) => (
					<div
						key={message.id}
						className={`message ${message.sender}`}
						style={{
							marginBottom: "10px",
							padding: "8px",
							borderRadius: "4px",
							backgroundColor:
								message.sender === "user"
									? "var(--vscode-editor-background)"
									: "var(--vscode-sideBar-background)",
						}}>
						{message.text}
					</div>
				))}
				<div ref={messagesEndRef} />
			</div>
			<VSCodeDivider />
			<div className="input-area" style={{ padding: 20 }}>
				<ResizingTextArea
					value={inputValue}
					onChange={setInputValue}
					placeholder="Type a message..."
					style={{ marginBottom: "10px", width: "100%" }}
				/>
				<VSCodeButton onClick={handleSendMessage}>Send</VSCodeButton>
				<VSCodeTextField>
					<section slot="end" style={{ display: "flex", alignItems: "center" }}>
						<VSCodeButton appearance="icon" aria-label="Match Case">
							<span className="codicon codicon-case-sensitive"></span>
						</VSCodeButton>
						<VSCodeButton appearance="icon" aria-label="Match Whole Word">
							<span className="codicon codicon-whole-word"></span>
						</VSCodeButton>
						<VSCodeButton appearance="icon" aria-label="Use Regular Expression">
							<span className="codicon codicon-regex"></span>
						</VSCodeButton>
					</section>
				</VSCodeTextField>
				<span slot="end" className="codicon codicon-chevron-right"></span>
				<VSCodeButton onClick={handleSendMessage}>Send</VSCodeButton>
			</div>
		</div>
	)
}

export default ChatSidebar
