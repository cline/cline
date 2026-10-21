import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { getLatestUserPrompt } from "../chat-view/utils/messageUtils"
import { MessageTimestamp, ResponseFinish, formatMessageTime } from "../MessageTimestamp"
import { StickyUserMessage } from "../task-header/StickyUserMessage"
import UserMessage from "../UserMessage"

const state = vi.hoisted(() => ({ showUserMessageTimestamps: true }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state }))
const task: ClineMessage = { ts: 1700000000000, type: "say", say: "task", text: "Initial task" }
const followup: ClineMessage = { ts: task.ts + 1000, type: "say", say: "user_feedback", text: "Latest prompt" }

describe("Chat usability", () => {
	it("selects the initial task, newest feedback and attachment-only submissions from resulting history", () => {
		expect(getLatestUserPrompt([])).toBeNull()
		expect(getLatestUserPrompt([task])).toBe(task)
		const attachment = { ...followup, ts: followup.ts + 1, text: "", files: ["synthetic.txt"] }
		const history = [task, followup, attachment, { ...task, ts: task.ts + 3000, say: "text" as const }]
		expect(getLatestUserPrompt(history)).toBe(attachment)
		expect(getLatestUserPrompt(history.slice(0, 2))).toBe(followup)
		const otherTask = { ...task, ts: task.ts + 5000, text: "Other task" }
		expect(getLatestUserPrompt([otherTask])).toBe(otherTask)
	})

	it("separates expansion from navigation and allows attachment previews", () => {
		const jump = vi.fn()
		render(
			<StickyUserMessage
				isVisible
				lastUserMessage={{ ...followup, text: "", files: ["synthetic.txt"] }}
				onScrollToMessage={jump}
			/>,
		)
		expect(screen.getByText("[Attachments]")).toBeVisible()
		fireEvent.click(screen.getByRole("button", { name: "Expand prompt" }))
		expect(screen.getByRole("button", { name: "Collapse prompt" })).toHaveAttribute("aria-expanded", "true")
		expect(jump).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Jump to original" }))
		expect(jump).toHaveBeenCalledOnce()
	})

	it("user checkbox hides only user time and reacts immediately", () => {
		state.showUserMessageTimestamps = true
		const response = { ...task, say: "text" as const, completedAt: task.ts + 2000 }
		const content = (
			<>
				<UserMessage messageTs={task.ts} text="Synthetic user" />
				<MessageTimestamp label="Started" timestamp={response.ts} />
				<ResponseFinish message={response} />
			</>
		)
		const view = render(content)
		expect(screen.getByText(/^Submitted:/)).toBeVisible()
		state.showUserMessageTimestamps = false
		view.rerender(<div>{content}</div>)
		expect(screen.queryByText(/^Submitted:/)).toBeNull()
		expect(screen.getByText(/^Started:/)).toBeVisible()
		expect(screen.getByText(/^Finished:/)).toBeVisible()
	})

	it("never invents finish dates for streaming or legacy responses", () => {
		const view = render(<ResponseFinish message={{ ...task, partial: true }} />)
		expect(view.container).toBeEmptyDOMElement()
		view.rerender(<ResponseFinish message={task} />)
		expect(view.container).toBeEmptyDOMElement()
		view.rerender(<ResponseFinish message={{ ...task, interruptedAt: task.ts + 1000 }} />)
		expect(screen.getByText(/^Interrupted:/)).toBeVisible()
		expect(screen.queryByText(/^Finished:/)).toBeNull()
	})

	it("formats recorded local instants with date, seconds and timezone", () => {
		expect(formatMessageTime(task.ts)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} .+/)
	})
})
