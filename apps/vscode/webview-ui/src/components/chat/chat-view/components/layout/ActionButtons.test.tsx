import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MessageHandlers } from "../../types/chatTypes"
import { ActionButtons } from "./ActionButtons"

describe("ActionButtons", () => {
	const mockMessageHandlers: MessageHandlers = {
		executeButtonAction: vi.fn(),
		updateChatHistory: vi.fn(),
		streamMessage: vi.fn(),
	} as any

	const mockChatState = {
		inputValue: "test input",
		selectedImages: [],
		selectedFiles: [],
		setSendingDisabled: vi.fn(),
		setInputValue: vi.fn(),
		setSelectedImages: vi.fn(),
		setSelectedFiles: vi.fn(),
	}

	const mockScrollBehavior = {
		scrollToBottomSmooth: vi.fn(),
		disableAutoScrollRef: { current: false },
		showScrollToBottom: false,
		virtuosoRef: { current: null },
	}

	const mockTask: ClineMessage = {
		ts: Date.now(),
		type: "ask",
		ask: "tool",
		text: JSON.stringify({ tool: "newFileCreated" }),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders save and reject buttons for file creation", () => {
		render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		expect(screen.getByText("Save")).toBeInTheDocument()
		expect(screen.getByText("Reject")).toBeInTheDocument()
	})

	it("disables buttons while processing action", async () => {
		mockMessageHandlers.executeButtonAction.mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(resolve, 100)
				}),
		)

		render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		const buttons = screen.getAllByText(/Save|Reject/)
		const saveButton = buttons[0] as unknown as HTMLElement
		const parentButton = saveButton.closest("vscode-button") as any
		expect(parentButton.disabled).not.toBe(true)

		fireEvent.click(saveButton)

		// Buttons should be disabled immediately after click
		expect(parentButton.disabled).toBe(true)

		// Wait for promise to resolve
		await waitFor(() => {
			expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalled()
		})
	})

	it("re-enables buttons after successful action completion", async () => {
		mockMessageHandlers.executeButtonAction.mockResolvedValue(undefined)

		const { rerender } = render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		const buttons = screen.getAllByText(/Save|Reject/)
		const saveButton = buttons[0] as unknown as HTMLElement
		fireEvent.click(saveButton)

		// Wait for the promise chain to complete
		await waitFor(
			() => {
				expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalled()
			},
			{ timeout: 500 },
		)

		// Rerender to pick up state change (buttons should be re-enabled)
		rerender(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		// Since isProcessing is set to false after .then(), buttons should be enabled
		// We verify this by checking that another click doesn't fire multiple actions
		fireEvent.click(saveButton)
		expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalledTimes(2)
	})

	it("re-enables buttons after error in action", async () => {
		mockMessageHandlers.executeButtonAction.mockRejectedValue(new Error("Test error"))

		const { rerender } = render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		const buttons = screen.getAllByText(/Save|Reject/)
		const saveButton = buttons[0] as unknown as HTMLElement
		fireEvent.click(saveButton)

		// Wait for the promise chain to complete
		await waitFor(
			() => {
				expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalled()
			},
			{ timeout: 500 },
		)

		// Rerender to pick up state change
		rerender(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		// Button should be enabled again after error, allowing another click
		fireEvent.click(saveButton)
		expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalledTimes(2)
	})

	it("allows sequential file approvals without getting stuck", async () => {
		mockMessageHandlers.executeButtonAction.mockResolvedValue(undefined)

		const { rerender } = render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		const buttons = screen.getAllByText(/Save|Reject/)
		const saveButton = buttons[0] as unknown as HTMLElement

		// First approval
		fireEvent.click(saveButton)
		await waitFor(() => {
			expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalledTimes(1)
		})

		// Rerender (simulating message update from backend)
		const secondTask: ClineMessage = {
			ts: Date.now() + 1000,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "editedExistingFile" }),
		}

		rerender(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask, secondTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={secondTask}
			/>,
		)

		// Second approval should be possible without buttons being stuck
		fireEvent.click(saveButton)
		await waitFor(() => {
			expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalledTimes(2)
		})
	})

	it("prevents rapid sequential clicks on the same action", async () => {
		mockMessageHandlers.executeButtonAction.mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(resolve, 50)
				}),
		)

		render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		const buttons = screen.getAllByText(/Save|Reject/)
		const saveButton = buttons[0] as unknown as HTMLElement

		// Rapid clicks while processing
		fireEvent.click(saveButton)
		fireEvent.click(saveButton)
		fireEvent.click(saveButton)

		// Should only execute once, not three times
		await waitFor(() => {
			expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalledTimes(1)
		})
	})

	it("calls executeButtonAction with correct parameters", async () => {
		mockMessageHandlers.executeButtonAction.mockResolvedValue(undefined)

		render(
			<ActionButtons
				chatState={{
					...mockChatState,
					inputValue: "save this",
					selectedImages: ["img1", "img2"],
					selectedFiles: ["file1", "file2"],
				} as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		const buttons = screen.getAllByText(/Save|Reject/)
		const saveButton = buttons[0] as unknown as HTMLElement
		fireEvent.click(saveButton)

		await waitFor(() => {
			expect(mockMessageHandlers.executeButtonAction).toHaveBeenCalledWith(
				"approve",
				"save this",
				["img1", "img2"],
				["file1", "file2"],
			)
		})
	})

	it("does not render action buttons when task is null", () => {
		render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={undefined}
			/>,
		)

		expect(screen.queryByRole("button", { name: /Save/i })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Reject/i })).not.toBeInTheDocument()
	})

	it("calls setSendingDisabled when button config changes", async () => {
		const { rerender } = render(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={mockTask}
			/>,
		)

		expect(mockChatState.setSendingDisabled).toHaveBeenCalled()

		// Change the task to trigger buttonConfig change
		const newTask: ClineMessage = {
			ts: Date.now() + 1000,
			type: "ask",
			ask: "command",
			text: "",
		}

		rerender(
			<ActionButtons
				chatState={mockChatState as any}
				messageHandlers={mockMessageHandlers}
				messages={[mockTask, newTask]}
				mode="act"
				scrollBehavior={mockScrollBehavior as any}
				task={newTask}
			/>,
		)

		// setSendingDisabled should have been called again
		expect(mockChatState.setSendingDisabled).toHaveBeenCalledTimes(2)
	})
})
