import "../../src/index.css"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { ExtensionStateContext, ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import { MessagesArea } from "@/components/chat/chat-view/components/layout/MessagesArea"
import { useScrollBehavior } from "@/components/chat/chat-view/hooks/useScrollBehavior"
import { filterVisibleMessages } from "@/components/chat/chat-view/utils/messageUtils"
import type { ChatState, MessageHandlers } from "@/components/chat/chat-view/types/chatTypes"

const prose = Array.from({ length: 25 }, (_, n) => `Paragraph ${n}. Synthetic response for scrolling and selection.`).join("\n\n")
const code = Array.from({ length: 100 }, (_, n) => `line_${n}: ${"long_code ".repeat(18)}`).join("\n")
const plan = `${prose}\n\n\`\`\`text\n${code}\n\`\`\`\n\n${prose}\n\n\`\`\`sql\n${code}\n\`\`\`\n\n${prose}`
const task: ClineMessage = { ts: 1700000000000, type: "say", say: "task", text: "Initial synthetic task" }
const submission: ClineMessage = {
	ts: task.ts + 1,
	type: "say",
	say: "user_feedback",
	text: `Latest submitted prompt\n${"Read the complete requirement.\n".repeat(30)}`,
}
const response: ClineMessage = {
	ts: task.ts + 2,
	type: "ask",
	ask: "plan_mode_respond",
	text: JSON.stringify({ response: plan }),
	completedAt: task.ts + 5000,
}
const initialMessages = [task, submission, response]

function Fixture() {
	const defaults = useExtensionState()
	const [messages, setMessages] = useState(initialMessages)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const visible = filterVisibleMessages(messages.slice(1))
	const scroll = useScrollBehavior(messages, visible, visible, expandedRows, setExpandedRows)
	const [showUserMessageTimestamps, setShowTimes] = useState(true)
	const chatState = { expandedRows, inputValue: "", setActiveQuote() {} } as unknown as ChatState
	const handlers = { executeButtonAction() {} } as unknown as MessageHandlers
	return (
		<ExtensionStateContext.Provider value={{ ...defaults, clineMessages: messages, showUserMessageTimestamps }}>
			<div style={{ height: 650, width: 500, display: "flex", flexDirection: "column", margin: 20 }}>
				<nav className="flex gap-2 shrink-0">
					<button onClick={() => setMessages(initialMessages)}>Plan</button>
					<button
						onClick={() =>
							setMessages([task, { ...response, type: "say", say: "text", ask: undefined, text: plan }])
						}>
						Initial only
					</button>
					<button
						onClick={() =>
							setMessages([
								...initialMessages,
								{ ...submission, ts: task.ts + 6000, text: "", images: ["data:image/png;base64,"] },
								{ ...response, ts: task.ts + 6001, type: "say", say: "text", ask: undefined, text: prose },
							])
						}>
						Attachments
					</button>
					<button
						onClick={() =>
							setMessages([
								{ ...task, ts: task.ts + 10000, text: "Other task" },
								{
									...response,
									ts: task.ts + 10001,
									type: "say",
									say: "completion_result",
									ask: undefined,
									text: plan,
								},
							])
						}>
						Switch task
					</button>
					<button
						onClick={() =>
							setMessages([
								...initialMessages,
								{ ...response, ts: task.ts + 7000, type: "say", say: "text", ask: undefined, text: prose },
							])
						}>
						After plan
					</button>
					<button
						onClick={() =>
							setMessages([
								task,
								{
									...response,
									text: JSON.stringify({
										response: "```sh\nprintf short\n```\n\n```sh\n" + "printf long; ".repeat(60) + "\n```",
									}),
								},
							])
						}>
						Short code
					</button>
					<button onClick={() => setShowTimes(!showUserMessageTimestamps)}>User times</button>
				</nav>
				<MessagesArea
					chatState={chatState}
					groupedMessages={visible}
					messageHandlers={handlers}
					modifiedMessages={messages.slice(1)}
					scrollBehavior={scroll}
					task={messages[0]}
				/>
			</div>
		</ExtensionStateContext.Provider>
	)
}
createRoot(document.getElementById("root")!).render(
	<ExtensionStateContextProvider>
		<Fixture />
	</ExtensionStateContextProvider>,
)
