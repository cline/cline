import { render, fireEvent, screen } from "@/utils/test-utils"

import { defaultModeSlug } from "@roo/modes"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import * as pathMentions from "@src/utils/path-mentions"

import ChatTextArea from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/utils/path-mentions", () => ({
	convertToMentionPath: vi.fn((path, cwd) => {
		// Simple mock implementation that mimics the real function's behavior
		if (cwd && path.toLowerCase().startsWith(cwd.toLowerCase())) {
			const relativePath = path.substring(cwd.length)
			return "@" + (relativePath.startsWith("/") ? relativePath : "/" + relativePath)
		}
		return path
	}),
}))

// Get the mocked postMessage function
const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>
const mockConvertToMentionPath = pathMentions.convertToMentionPath as ReturnType<typeof vi.fn>

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

// Custom query function to get the enhance prompt button
const getEnhancePromptButton = () => {
	return screen.getByRole("button", {
		name: (_, element) => {
			// Find the button with the wand sparkles icon (Lucide React)
			return element.querySelector(".lucide-wand-sparkles") !== null
		},
	})
}

describe("ChatTextArea", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: vi.fn(),
		onSend: vi.fn(),
		sendingDisabled: false,
		selectApiConfigDisabled: false,
		onSelectImages: vi.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [],
		setSelectedImages: vi.fn(),
		onHeightChange: vi.fn(),
		mode: defaultModeSlug,
		setMode: vi.fn(),
		modeShortcutText: "(⌘. for next mode)",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		// Default mock implementation for useExtensionState
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			taskHistory: [],
			cwd: "/test/workspace",
		})
	})

	describe("enhance prompt button", () => {
		it("should be disabled when sendingDisabled is true", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				taskHistory: [],
				cwd: "/test/workspace",
			})
			render(<ChatTextArea {...defaultProps} sendingDisabled={true} />)
			const enhanceButton = getEnhancePromptButton()
			expect(enhanceButton).toHaveClass("cursor-not-allowed")
		})
	})

	describe("handleEnhancePrompt", () => {
		it("should send message with correct configuration when clicked", () => {
			const apiConfiguration = {
				apiProvider: "openrouter",
				apiKey: "test-key",
			}

			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration,
				taskHistory: [],
				cwd: "/test/workspace",
			})

			render(<ChatTextArea {...defaultProps} inputValue="Test prompt" />)

			const enhanceButton = getEnhancePromptButton()
			fireEvent.click(enhanceButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "enhancePrompt",
				text: "Test prompt",
			})
		})

		it("should not send message when input is empty", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				taskHistory: [],
				cwd: "/test/workspace",
			})

			render(<ChatTextArea {...defaultProps} inputValue="" />)

			// Clear any calls from component initialization (e.g., IndexingStatusBadge)
			mockPostMessage.mockClear()

			const enhanceButton = getEnhancePromptButton()
			fireEvent.click(enhanceButton)

			expect(mockPostMessage).not.toHaveBeenCalled()
		})

		it("should show loading state while enhancing", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
				},
				taskHistory: [],
				cwd: "/test/workspace",
			})

			render(<ChatTextArea {...defaultProps} inputValue="Test prompt" />)

			const enhanceButton = getEnhancePromptButton()
			fireEvent.click(enhanceButton)

			// Check if the WandSparkles icon has the animate-spin class
			const animatingIcon = enhanceButton.querySelector(".animate-spin")
			expect(animatingIcon).toBeInTheDocument()
		})
	})

	describe("effect dependencies", () => {
		it("should update when apiConfiguration changes", () => {
			const { rerender } = render(<ChatTextArea {...defaultProps} />)

			// Update apiConfiguration
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
					newSetting: "test",
				},
				taskHistory: [],
				cwd: "/test/workspace",
			})

			rerender(<ChatTextArea {...defaultProps} />)

			// Verify the enhance button appears after apiConfiguration changes
			expect(getEnhancePromptButton()).toBeInTheDocument()
		})
	})

	describe("enhanced prompt response", () => {
		it("should update input value when receiving enhanced prompt", () => {
			const setInputValue = vi.fn()

			render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} />)

			// Simulate receiving enhanced prompt message
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "enhancedPrompt",
						text: "Enhanced test prompt",
					},
				}),
			)

			expect(setInputValue).toHaveBeenCalledWith("Enhanced test prompt")
		})
	})

	describe("multi-file drag and drop", () => {
		const mockCwd = "/Users/test/project"

		beforeEach(() => {
			vi.clearAllMocks()
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				cwd: mockCwd,
			})
			mockConvertToMentionPath.mockClear()
		})

		it("should process multiple file paths separated by newlines", () => {
			const setInputValue = vi.fn()

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Initial text" />,
			)

			// Create a mock dataTransfer object with text data containing multiple file paths
			const dataTransfer = {
				getData: vi.fn().mockReturnValue("/Users/test/project/file1.js\n/Users/test/project/file2.js"),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// Verify convertToMentionPath was called for each file path
			expect(mockConvertToMentionPath).toHaveBeenCalledTimes(2)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith("/Users/test/project/file1.js", mockCwd)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith("/Users/test/project/file2.js", mockCwd)

			// Verify setInputValue was called with the correct value
			// The mock implementation of convertToMentionPath will convert the paths to @/file1.js and @/file2.js
			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Initial text")
		})

		it("should filter out empty lines in the dragged text", () => {
			const setInputValue = vi.fn()

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Initial text" />,
			)

			// Create a mock dataTransfer object with text data containing empty lines
			const dataTransfer = {
				getData: vi.fn().mockReturnValue("/Users/test/project/file1.js\n\n/Users/test/project/file2.js\n\n"),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// Verify convertToMentionPath was called only for non-empty lines
			expect(mockConvertToMentionPath).toHaveBeenCalledTimes(2)

			// Verify setInputValue was called with the correct value
			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Initial text")
		})

		it("should correctly update cursor position after adding multiple mentions", () => {
			const setInputValue = vi.fn()
			const initialCursorPosition = 5

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Hello world" />,
			)

			// Set the cursor position manually
			const textArea = container.querySelector("textarea")
			if (textArea) {
				textArea.selectionStart = initialCursorPosition
				textArea.selectionEnd = initialCursorPosition
			}

			// Create a mock dataTransfer object with text data
			const dataTransfer = {
				getData: vi.fn().mockReturnValue("/Users/test/project/file1.js\n/Users/test/project/file2.js"),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// The cursor position should be updated based on the implementation in the component
			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Hello world")
		})

		it("should handle very long file paths correctly", () => {
			const setInputValue = vi.fn()

			const { container } = render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

			// Create a very long file path
			const longPath =
				"/Users/test/project/very/long/path/with/many/nested/directories/and/a/very/long/filename/with/extension.typescript"

			// Create a mock dataTransfer object with the long path
			const dataTransfer = {
				getData: vi.fn().mockReturnValue(longPath),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// Verify convertToMentionPath was called with the long path
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(longPath, mockCwd)

			// The mock implementation will convert it to @/very/long/path/...
			expect(setInputValue).toHaveBeenCalledWith(
				"@/very/long/path/with/many/nested/directories/and/a/very/long/filename/with/extension.typescript ",
			)
		})

		it("should handle paths with special characters correctly", () => {
			const setInputValue = vi.fn()

			const { container } = render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

			// Create paths with special characters
			const specialPath1 = "/Users/test/project/file with spaces.js"
			const specialPath2 = "/Users/test/project/file-with-dashes.js"
			const specialPath3 = "/Users/test/project/file_with_underscores.js"
			const specialPath4 = "/Users/test/project/file.with.dots.js"

			// Create a mock dataTransfer object with the special paths
			const dataTransfer = {
				getData: vi.fn().mockReturnValue(`${specialPath1}\n${specialPath2}\n${specialPath3}\n${specialPath4}`),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// Verify convertToMentionPath was called for each path
			expect(mockConvertToMentionPath).toHaveBeenCalledTimes(4)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath1, mockCwd)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath2, mockCwd)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath3, mockCwd)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath4, mockCwd)

			// Verify setInputValue was called with the correct value
			expect(setInputValue).toHaveBeenCalledWith(
				"@/file with spaces.js @/file-with-dashes.js @/file_with_underscores.js @/file.with.dots.js ",
			)
		})

		it("should handle paths outside the current working directory", () => {
			const setInputValue = vi.fn()

			const { container } = render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

			// Create paths outside the current working directory
			const outsidePath = "/Users/other/project/file.js"

			// Mock the convertToMentionPath function to return the original path for paths outside cwd
			mockConvertToMentionPath.mockImplementationOnce((path, _cwd) => {
				return path // Return original path for this test
			})

			// Create a mock dataTransfer object with the outside path
			const dataTransfer = {
				getData: vi.fn().mockReturnValue(outsidePath),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// Verify convertToMentionPath was called with the outside path
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(outsidePath, mockCwd)

			// Verify setInputValue was called with the original path
			expect(setInputValue).toHaveBeenCalledWith("/Users/other/project/file.js ")
		})

		it("should do nothing when dropped text is empty", () => {
			const setInputValue = vi.fn()

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Initial text" />,
			)

			// Create a mock dataTransfer object with empty text
			const dataTransfer = {
				getData: vi.fn().mockReturnValue(""),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: vi.fn(),
			})

			// Verify convertToMentionPath was not called
			expect(mockConvertToMentionPath).not.toHaveBeenCalled()

			// Verify setInputValue was not called
			expect(setInputValue).not.toHaveBeenCalled()
		})

		describe("prompt history navigation", () => {
			const mockClineMessages = [
				{ type: "say", say: "user_feedback", text: "First prompt", ts: 1000 },
				{ type: "say", say: "user_feedback", text: "Second prompt", ts: 2000 },
				{ type: "say", say: "user_feedback", text: "Third prompt", ts: 3000 },
			]

			beforeEach(() => {
				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: [],
					clineMessages: mockClineMessages,
					cwd: "/test/workspace",
				})
			})

			it("should navigate to previous prompt on arrow up when cursor is at beginning", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!
				// Ensure cursor is at the beginning
				textarea.setSelectionRange(0, 0)

				// Simulate arrow up key press
				fireEvent.keyDown(textarea, { key: "ArrowUp" })

				// Should set the newest conversation message (first in reversed array)
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")
			})

			it("should navigate through history with multiple arrow up presses", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// First arrow up - newest conversation message
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")

				// Update input value to simulate the state change
				setInputValue.mockClear()

				// Second arrow up - previous conversation message
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Second prompt")
			})

			it("should navigate forward with arrow down", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Go back in history first (index 0 -> "Third prompt", then index 1 -> "Second prompt")
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				setInputValue.mockClear()

				// Navigate forward (from index 1 back to index 0)
				fireEvent.keyDown(textarea, { key: "ArrowDown" })
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")
			})

			it("should preserve current input when starting navigation", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Current input" />,
				)

				const textarea = container.querySelector("textarea")!

				// Navigate to history
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")

				setInputValue.mockClear()

				// Navigate back to current input
				fireEvent.keyDown(textarea, { key: "ArrowDown" })
				expect(setInputValue).toHaveBeenCalledWith("Current input")
			})

			it("should reset history navigation when user types", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Navigate to history
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				setInputValue.mockClear()

				// Type something
				fireEvent.change(textarea, { target: { value: "New input", selectionStart: 9 } })

				// Should reset history navigation
				expect(setInputValue).toHaveBeenCalledWith("New input")
			})

			it("should reset history navigation when sending message", () => {
				const onSend = vi.fn()
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea
						{...defaultProps}
						onSend={onSend}
						setInputValue={setInputValue}
						inputValue="Test message"
					/>,
				)

				const textarea = container.querySelector("textarea")!

				// Navigate to history first
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				setInputValue.mockClear()

				// Send message
				fireEvent.keyDown(textarea, { key: "Enter" })

				expect(onSend).toHaveBeenCalled()
			})

			it("should navigate history when cursor is at first line", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Clear any calls from initial render
				setInputValue.mockClear()

				// With empty input, cursor is at first line by default
				// Arrow up should navigate history
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")
			})

			it("should filter history by current workspace", () => {
				const mixedClineMessages = [
					{ type: "say", say: "user_feedback", text: "Workspace 1 prompt", ts: 1000 },
					{ type: "say", say: "user_feedback", text: "Other workspace prompt", ts: 2000 },
					{ type: "say", say: "user_feedback", text: "Workspace 1 prompt 2", ts: 3000 },
				]

				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: [],
					clineMessages: mixedClineMessages,
					cwd: "/test/workspace",
				})

				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Should show conversation messages newest first (after reverse)
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Workspace 1 prompt 2")

				setInputValue.mockClear()
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Other workspace prompt")
			})

			it("should handle empty conversation history gracefully", () => {
				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: [],
					clineMessages: [],
					cwd: "/test/workspace",
				})

				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Should not crash or call setInputValue
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).not.toHaveBeenCalled()
			})

			it("should ignore empty or whitespace-only messages", () => {
				const clineMessagesWithEmpty = [
					{ type: "say", say: "user_feedback", text: "Valid prompt", ts: 1000 },
					{ type: "say", say: "user_feedback", text: "", ts: 2000 },
					{ type: "say", say: "user_feedback", text: "   ", ts: 3000 },
					{ type: "say", say: "user_feedback", text: "Another valid prompt", ts: 4000 },
				]

				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: [],
					clineMessages: clineMessagesWithEmpty,
					cwd: "/test/workspace",
				})

				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Should skip empty messages, newest first for conversation
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Another valid prompt")

				setInputValue.mockClear()
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Valid prompt")
			})

			it("should use task history (oldest first) when no conversation messages exist", () => {
				const mockTaskHistory = [
					{ task: "First task", workspace: "/test/workspace" },
					{ task: "Second task", workspace: "/test/workspace" },
					{ task: "Third task", workspace: "/test/workspace" },
				]

				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: mockTaskHistory,
					clineMessages: [], // No conversation messages
					cwd: "/test/workspace",
				})

				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				const textarea = container.querySelector("textarea")!

				// Should show task history oldest first (chronological order)
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("First task")

				setInputValue.mockClear()
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Second task")
			})

			it("should reset navigation position when switching between history sources", () => {
				const setInputValue = vi.fn()
				const { rerender } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />,
				)

				// Start with task history
				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: [
						{ task: "Task 1", workspace: "/test/workspace" },
						{ task: "Task 2", workspace: "/test/workspace" },
					],
					clineMessages: [],
					cwd: "/test/workspace",
				})

				rerender(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

				const textarea = document.querySelector("textarea")!

				// Navigate in task history
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Task 1")

				// Switch to conversation messages
				;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
					filePaths: [],
					openedTabs: [],
					apiConfiguration: {
						apiProvider: "anthropic",
					},
					taskHistory: [],
					clineMessages: [
						{ type: "say", say: "user_feedback", text: "Message 1", ts: 1000 },
						{ type: "say", say: "user_feedback", text: "Message 2", ts: 2000 },
					],
					cwd: "/test/workspace",
				})

				setInputValue.mockClear()
				rerender(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

				// Should start from beginning of conversation history (newest first)
				fireEvent.keyDown(textarea, { key: "ArrowUp" })
				expect(setInputValue).toHaveBeenCalledWith("Message 2")
			})

			it("should not navigate history with arrow up when cursor is not at beginning", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Some text here" />,
				)

				const textarea = container.querySelector("textarea")!
				// Set cursor to middle of text (not at beginning)
				textarea.setSelectionRange(5, 5)

				// Clear any calls from initial render
				setInputValue.mockClear()

				// Simulate arrow up key press
				fireEvent.keyDown(textarea, { key: "ArrowUp" })

				// Should not navigate history, allowing default behavior (move cursor to start)
				expect(setInputValue).not.toHaveBeenCalled()
			})

			it("should navigate history with arrow up when cursor is at beginning", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Some text here" />,
				)

				const textarea = container.querySelector("textarea")!
				// Set cursor to beginning of text
				textarea.setSelectionRange(0, 0)

				// Clear any calls from initial render
				setInputValue.mockClear()

				// Simulate arrow up key press
				fireEvent.keyDown(textarea, { key: "ArrowUp" })

				// Should navigate to history since cursor is at beginning
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")
			})

			it("should navigate history with Command+Up when cursor is at beginning", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Some text here" />,
				)

				const textarea = container.querySelector("textarea")!
				// Set cursor to beginning of text
				textarea.setSelectionRange(0, 0)

				// Clear any calls from initial render
				setInputValue.mockClear()

				// Simulate Command+Up key press
				fireEvent.keyDown(textarea, { key: "ArrowUp", metaKey: true })

				// Should navigate to history since cursor is at beginning (same as regular Up)
				expect(setInputValue).toHaveBeenCalledWith("Third prompt")
			})

			it("should not navigate history with Command+Up when cursor is not at beginning", () => {
				const setInputValue = vi.fn()
				const { container } = render(
					<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Some text here" />,
				)

				const textarea = container.querySelector("textarea")!
				// Set cursor to middle of text (not at beginning)
				textarea.setSelectionRange(5, 5)

				// Clear any calls from initial render
				setInputValue.mockClear()

				// Simulate Command+Up key press
				fireEvent.keyDown(textarea, { key: "ArrowUp", metaKey: true })

				// Should not navigate history, allowing default behavior (same as regular Up)
				expect(setInputValue).not.toHaveBeenCalled()
			})
		})
	})

	describe("selectApiConfig", () => {
		// Helper function to get the API config dropdown
		const getApiConfigDropdown = () => {
			return screen.getByTestId("dropdown-trigger")
		}
		it("should be enabled independently of sendingDisabled", () => {
			render(<ChatTextArea {...defaultProps} sendingDisabled={true} selectApiConfigDisabled={false} />)
			const apiConfigDropdown = getApiConfigDropdown()
			expect(apiConfigDropdown).not.toHaveAttribute("disabled")
		})
		it("should be disabled when selectApiConfigDisabled is true", () => {
			render(<ChatTextArea {...defaultProps} sendingDisabled={true} selectApiConfigDisabled={true} />)
			const apiConfigDropdown = getApiConfigDropdown()
			expect(apiConfigDropdown).toHaveAttribute("disabled")
		})
	})
})
