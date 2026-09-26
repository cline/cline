import type { TurnState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { InputSection } from "./InputSection"

const mockTurnState = vi.fn<() => TurnState | undefined>(() => undefined)
const mockCloudState = vi.fn<() => Record<string, unknown>>(() => ({}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ turnState: mockTurnState(), ...mockCloudState() }),
}))

vi.mock("@/components/chat/ChatTextArea", () => ({
	default: React.forwardRef<HTMLTextAreaElement, { sendingDisabled: boolean; onSend: () => void }>(
		({ sendingDisabled, onSend }, ref) => (
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

	it.each([
		["without a repository", { target: "cloud" }, true],
		["with a repository", { target: "cloud", repoUrl: "https://github.com/cline/fixture" }, false],
	])("on the home screen with Cloud selected %s, submit disabled=%s", (_label, cloudTaskTarget, disabled) => {
		mockTurnState.mockReturnValue({ phase: "idle", seq: 1 })
		mockCloudState.mockReturnValue({ cloudSessionsEnabled: true, cloudTaskTarget, clineMessages: [] })
		const handleSendMessage = vi.fn().mockResolvedValue(undefined)

		render(
			<InputSection
				chatState={makeChatState({ sendingDisabled: false })}
				messageHandlers={{ handleSendMessage } as unknown as MessageHandlers}
				placeholderText="Type a message"
				scrollBehavior={makeScrollBehavior()}
				selectFilesAndImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		const composer = screen.getByLabelText("composer")
		fireEvent.keyDown(composer, { key: "Enter" })
		if (disabled) {
			expect(composer).toBeDisabled()
			expect(handleSendMessage).not.toHaveBeenCalled()
		} else {
			expect(composer).not.toBeDisabled()
			expect(handleSendMessage).toHaveBeenCalledWith("queue this", [], [])
		}
		mockCloudState.mockReturnValue({})
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
})
