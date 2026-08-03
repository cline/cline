import type { TurnState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { InputSection } from "./InputSection"

const mockTurnState = vi.fn<() => TurnState | undefined>(() => undefined)
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({}),
	useMessagesState: () => ({ turnState: mockTurnState() }),
}))

vi.mock("@/components/chat/ChatTextArea", () => ({
	default: React.forwardRef<HTMLTextAreaElement, { sendingDisabled: boolean; onSend: (delivery?: "queue" | "steer") => void }>(
		({ sendingDisabled, onSend }, ref) => (
			<textarea
				aria-label="composer"
				disabled={sendingDisabled}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !sendingDisabled) {
						// Mirror the real ChatTextArea contract: Ctrl/Cmd+Enter is a steer.
						onSend(event.ctrlKey || event.metaKey ? "steer" : undefined)
					}
				}}
				ref={ref}
			/>
		),
	),
}))

function makeChatState(overrides: Partial<ChatState> = {}): ChatState {
	return {
		activeQuote: null,
		setActiveQuote: vi.fn(),
		isTextAreaFocused: false,
		inputValue: "queue this",
		setInputValue: vi.fn(),
		sendingDisabled: true,
		selectedImages: [],
		setSelectedImages: vi.fn(),
		selectedFiles: [],
		setSelectedFiles: vi.fn(),
		textAreaRef: { current: null },
		handleFocusChange: vi.fn(),
		...overrides,
	} as unknown as ChatState
}

function makeScrollBehavior(): ScrollBehavior {
	return {
		isAtBottom: true,
		scrollToBottomAuto: vi.fn(),
	} as unknown as ScrollBehavior
}

describe("InputSection", () => {
	it("allows submit while the turn is streaming so the message can be queued", () => {
		mockTurnState.mockReturnValue({ phase: "streaming", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ sendingDisabled: true })}
				messageHandlers={{ handleSendMessage } as unknown as MessageHandlers}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		expect(composer).not.toBeDisabled()

		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [], undefined)
	})

	it("allows submit while approval is pending so typed feedback can reject the approval", () => {
		mockTurnState.mockReturnValue({ phase: "awaiting_approval", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ sendingDisabled: true })}
				messageHandlers={{ handleSendMessage } as unknown as MessageHandlers}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		expect(composer).not.toBeDisabled()

		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [], undefined)
	})

	it("allows submit for legacy active-task state when turnState is unavailable", () => {
		mockTurnState.mockReturnValue(undefined)
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({
					lastMessage: { ts: 1, type: "say", say: "api_req_started", partial: false },
					sendingDisabled: true,
				})}
				messageHandlers={{ handleSendMessage } as unknown as MessageHandlers}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		expect(composer).not.toBeDisabled()

		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [], undefined)
	})

	it("keeps submit disabled for non-active blocked states", () => {
		mockTurnState.mockReturnValue({ phase: "error", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ sendingDisabled: true })}
				messageHandlers={{ handleSendMessage } as unknown as MessageHandlers}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		expect(composer).toBeDisabled()

		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).not.toHaveBeenCalled()
	})

	it("forwards Ctrl+Enter as a steer delivery so it can interrupt an in-flight turn", () => {
		mockTurnState.mockReturnValue({ phase: "streaming", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ sendingDisabled: true })}
				messageHandlers={{ handleSendMessage } as unknown as MessageHandlers}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true })
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [], "steer")
	})
})
