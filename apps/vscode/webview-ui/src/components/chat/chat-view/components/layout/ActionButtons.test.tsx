import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"
import { ActionButtons } from "./ActionButtons"

// Render VSCodeButton as a native button so `disabled` is observable in the DOM.
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => (
		<button disabled={disabled} onClick={onClick} type="button">
			{children}
		</button>
	),
}))

const mockTurnState = vi.fn<() => TurnState | undefined>(() => undefined)
vi.mock("../../../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ turnState: mockTurnState() }),
}))

function fileApprovalAsk(ts: number, path: string): ClineMessage {
	return {
		ts,
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "newFileCreated", path }),
		partial: false,
	}
}

function makeChatState(): ChatState {
	const draft = { revision: 3, text: "", activeQuote: null, images: [] as string[], files: [] as string[] }
	return {
		inputValue: draft.text,
		activeQuote: draft.activeQuote,
		selectedImages: draft.images,
		selectedFiles: draft.files,
		setInputValue: vi.fn(),
		setActiveQuote: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
		getDraftSnapshot: vi.fn(() => draft),
		consumeDraftSnapshot: vi.fn(),
		setSendingDisabled: vi.fn(),
	} as unknown as ChatState
}

describe("ActionButtons", () => {
	it("does not render a scroll button when there are no action buttons", () => {
		mockTurnState.mockReturnValue(undefined)
		const task: ClineMessage = {
			ts: 1,
			type: "ask",
			ask: "followup",
			text: "Anything else?",
			partial: false,
		}

		render(
			<ActionButtons
				chatState={makeChatState()}
				messageHandlers={{ executeButtonAction: vi.fn() } as unknown as MessageHandlers}
				messages={[task]}
				mode="act"
				task={task}
			/>,
		)

		expect(screen.queryByRole("button")).not.toBeInTheDocument()
		expect(screen.queryByLabelText("Scroll to bottom")).not.toBeInTheDocument()
		expect(screen.queryByLabelText("Scroll to top")).not.toBeInTheDocument()
	})

	it("re-enables the buttons when a second identical approval ask arrives", async () => {
		// Regression: the button configs are shared singletons, so two consecutive
		// "create file" asks return the same object. Clicking the first latches a
		// local processing flag; the latch must clear when the next ask arrives so
		// the user can act on it.
		mockTurnState.mockReturnValue({ phase: "awaiting_approval", anchorTs: 1 })
		const executeButtonAction = vi.fn().mockResolvedValue(undefined)
		const messageHandlers = {
			executeButtonAction,
		} as unknown as MessageHandlers

		const task = fileApprovalAsk(1, "/notes.txt")
		const props = {
			task,
			chatState: makeChatState(),
			messageHandlers,
			mode: "act" as const,
		}

		const { rerender } = render(<ActionButtons {...props} messages={[task]} />)

		const save = screen.getByRole("button", { name: "Save" })
		expect(save).not.toBeDisabled()

		// Approving latches the processing flag, disabling the buttons.
		fireEvent.click(save)
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

		// A second create-file ask arrives. Its config is the same object as the
		// first, but the anchored timestamp changes — buttons must re-enable.
		const secondAsk = fileApprovalAsk(2, "/notes2.txt")
		mockTurnState.mockReturnValue({ phase: "awaiting_approval", anchorTs: 2 })
		rerender(<ActionButtons {...props} messages={[task, secondAsk]} />)

		expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
		expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled()
	})

	it("passes Retry its preserving action without reading the draft", () => {
		mockTurnState.mockReturnValue({ phase: "error", anchorTs: 2 })
		const task: ClineMessage = { ts: 1, type: "say", say: "task", text: "task" }
		const failed: ClineMessage = { ts: 2, type: "ask", ask: "api_req_failed", text: "server error" }
		const executeButtonAction = vi.fn().mockResolvedValue(undefined)
		const chatState = {
			...makeChatState(),
			inputValue: "unsent draft",
			activeQuote: "selected context",
			selectedImages: ["image.png"],
			selectedFiles: ["notes.md"],
			getDraftSnapshot: vi.fn(() => ({
				revision: 9,
				text: "unsent draft",
				activeQuote: "selected context",
				images: ["image.png"],
				files: ["notes.md"],
			})),
		} as ChatState

		render(
			<ActionButtons
				chatState={chatState}
				messageHandlers={{ executeButtonAction } as unknown as MessageHandlers}
				messages={[task, failed]}
				mode="act"
				task={task}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Retry" }))

		expect(executeButtonAction).toHaveBeenCalledWith({ type: "retry" })
		expect(chatState.getDraftSnapshot).not.toHaveBeenCalled()
	})

	it("passes a submitting action the complete draft snapshot", () => {
		mockTurnState.mockReturnValue({ phase: "awaiting_approval", anchorTs: 1 })
		const task = fileApprovalAsk(1, "/notes.txt")
		const draft = {
			revision: 12,
			text: "approval feedback",
			activeQuote: "selected context",
			images: ["image.png"],
			files: ["notes.md"],
		}
		const executeButtonAction = vi.fn().mockResolvedValue(undefined)
		const chatState = { ...makeChatState(), getDraftSnapshot: vi.fn(() => draft) } as ChatState

		render(
			<ActionButtons
				chatState={chatState}
				messageHandlers={{ executeButtonAction } as unknown as MessageHandlers}
				messages={[task]}
				mode="act"
				task={task}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Save" }))

		expect(executeButtonAction).toHaveBeenCalledWith({ type: "approve", draft })
	})

	it("does not clear a draft when command output advances to the next request", () => {
		mockTurnState.mockReturnValue({ phase: "streaming" })
		const commandOutput: ClineMessage = { ts: 1, type: "ask", ask: "command_output", text: "partial output" }
		const requestStarted: ClineMessage = { ts: 2, type: "say", say: "api_req_started", text: "{}" }
		const chatState = makeChatState()

		render(
			<ActionButtons
				chatState={chatState}
				messageHandlers={{ executeButtonAction: vi.fn() } as unknown as MessageHandlers}
				messages={[commandOutput, requestStarted]}
				mode="act"
				task={commandOutput}
			/>,
		)

		expect(chatState.setInputValue).not.toHaveBeenCalled()
		expect(chatState.setSelectedImages).not.toHaveBeenCalled()
		expect(chatState.setSelectedFiles).not.toHaveBeenCalled()
	})
})
