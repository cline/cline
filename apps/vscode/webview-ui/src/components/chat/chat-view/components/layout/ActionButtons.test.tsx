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
	return {
		inputValue: "",
		selectedImages: [],
		selectedFiles: [],
		setInputValue: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
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

		expect(screen.queryBy角色("button")).not.toBeInTheDocument()
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

		const save = screen.getBy角色("button", { name: "Save" })
		expect(save).not.toBeDisabled()

		// Approving latches the processing flag, disabling the buttons.
		fireEvent.click(save)
		expect(screen.getBy角色("button", { name: "Save" })).toBeDisabled()

		// A second create-file ask arrives. Its config is the same object as the
		// first, but the anchored timestamp changes — buttons must re-enable.
		const secondAsk = fileApprovalAsk(2, "/notes2.txt")
		mockTurnState.mockReturnValue({ phase: "awaiting_approval", anchorTs: 2 })
		rerender(<ActionButtons {...props} messages={[task, secondAsk]} />)

		expect(screen.getBy角色("button", { name: "Save" })).not.toBeDisabled()
		expect(screen.getBy角色("button", { name: "Reject" })).not.toBeDisabled()
	})
})
