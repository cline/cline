import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "../../../../../../src/shared/ExtensionMessage"
import { MemoizedMessageRenderer } from "./MessageRenderer"

const renderCounts = new Map<number, number>()

vi.mock("@/components/chat/ChatRow", () => ({
	default: ({ message }: { message: ClineMessage }) => {
		renderCounts.set(message.ts, (renderCounts.get(message.ts) ?? 0) + 1)
		return <div data-testid={`chat-row-${message.ts}`}>{message.text}</div>
	},
}))

vi.mock("@/components/chat/BrowserSessionRow", () => ({
	default: () => <div data-testid="browser-session-row" />,
}))

vi.mock("./ToolGroupRenderer", () => ({
	ToolGroupRenderer: () => <div data-testid="tool-group-row" />,
}))

describe("MemoizedMessageRenderer", () => {
	beforeEach(() => {
		renderCounts.clear()
	})

	it("avoids rerendering unrelated text rows when pending state changes for another row", () => {
		const firstMessage = { ts: 1, type: "say", say: "text", text: "first" } as ClineMessage
		const secondMessage = { ts: 2, type: "say", say: "text", text: "second" } as ClineMessage
		const groupedMessages = [firstMessage, secondMessage]
		const baseProps = {
			groupedMessages,
			modifiedMessages: [firstMessage, secondMessage],
			rawMessages: [firstMessage, secondMessage],
			mode: "act" as const,
			expandedRows: {},
			onToggleExpand: vi.fn(),
			onHeightChange: vi.fn(),
			onSetQuote: vi.fn(),
			inputValue: "",
			messageHandlers: {
				executeButtonAction: vi.fn(),
				handleSendMessage: vi.fn(),
				handleTaskCloseButtonClick: vi.fn(),
				startNewTask: vi.fn(),
			},
			footerActive: false,
			apiReqReasoningIndex: new Map(),
			pendingTextMessageIndex: new Set<number>(),
		}

		const { rerender } = render(
			<>
				<MemoizedMessageRenderer {...baseProps} index={0} messageOrGroup={firstMessage} />
				<MemoizedMessageRenderer {...baseProps} index={1} messageOrGroup={secondMessage} />
			</>,
		)

		expect(renderCounts.get(1)).toBe(1)
		expect(renderCounts.get(2)).toBe(1)

		rerender(
			<>
				<MemoizedMessageRenderer
					{...baseProps}
					index={0}
					messageOrGroup={firstMessage}
					pendingTextMessageIndex={new Set([2])}
				/>
				<MemoizedMessageRenderer
					{...baseProps}
					index={1}
					messageOrGroup={secondMessage}
					pendingTextMessageIndex={new Set([2])}
				/>
			</>,
		)

		expect(renderCounts.get(1)).toBe(1)
		expect(renderCounts.get(2)).toBe(2)
	})
})
