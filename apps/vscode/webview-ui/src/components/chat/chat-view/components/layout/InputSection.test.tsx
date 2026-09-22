import type { TurnState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { InputSection } from "./InputSection"

const mockTurnState = vi.fn<() => TurnState | undefined>(() => undefined)
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ turnState: mockTurnState() }),
}))

vi.mock("@/components/chat/ChatTextArea", () => ({
	default: React.forwardRef<HTMLTextAreaElement, { sendingDisabled: boolean; onSend: () => void }>(
		({ sendingDisabled, onSend }, ref) => (
			<>
				<textarea
					aria-label="composer"
					disabled={sendingDisabled}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !sendingDisabled) {
							onSend()
						}
					}}
					ref={ref}
				/>
				<button disabled={sendingDisabled} onClick={onSend} type="button">
					Send
				</button>
			</>
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
		const sendButton = screen.getByRole("button", { name: "Send" })
		expect(sendButton).not.toBeDisabled()

		fireEvent.click(sendButton)
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [])
		handleSendMessage.mockClear()
		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [])
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
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [])
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
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [])
	})

	it("allows submit after a failed request so the draft can start the next turn", () => {
		mockTurnState.mockReturnValue({ phase: "error", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ clineAsk: "api_req_failed", sendingDisabled: true })}
				messageHandlers={
					{
						errorRecoveryAvailable: true,
						handleSendMessage,
						recoveryActionInFlight: false,
					} as unknown as MessageHandlers
				}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		expect(composer).not.toBeDisabled()

		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [])
	})

	it("keeps submit disabled for fatal errors", () => {
		mockTurnState.mockReturnValue({ phase: "error", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ clineAsk: undefined, sendingDisabled: true })}
				messageHandlers={
					{
						errorRecoveryAvailable: false,
						handleSendMessage,
						recoveryActionInFlight: false,
					} as unknown as MessageHandlers
				}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		expect(screen.getByLabelText("composer")).toBeDisabled()
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
	})

	it("disables a second error-state submit while the first response is pending", () => {
		mockTurnState.mockReturnValue({ phase: "error", seq: 1 })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({
					clineAsk: "api_req_failed",
					pendingResponse: { id: 1, turnStateSeq: 1, messageCount: 2 },
					sendingDisabled: true,
				})}
				messageHandlers={
					{
						errorRecoveryAvailable: true,
						handleSendMessage,
						recoveryActionInFlight: false,
					} as unknown as MessageHandlers
				}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		expect(composer).toBeDisabled()
		const sendButton = screen.getByRole("button", { name: "Send" })
		expect(sendButton).toBeDisabled()

		fireEvent.click(sendButton)
		fireEvent.keyDown(composer, { key: "Enter" })
		expect(handleSendMessage).not.toHaveBeenCalled()
	})

	it("disables recovery submit while a footer action is in flight", () => {
		mockTurnState.mockReturnValue({ phase: "error", seq: 1 })

		render(
			<InputSection
				chatState={makeChatState({ clineAsk: "api_req_failed", sendingDisabled: true })}
				messageHandlers={
					{
						errorRecoveryAvailable: true,
						handleSendMessage: vi.fn(),
						recoveryActionInFlight: true,
					} as unknown as MessageHandlers
				}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		expect(screen.getByLabelText("composer")).toBeDisabled()
		expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
	})
})
