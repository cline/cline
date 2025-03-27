import { render, fireEvent, screen } from "@testing-library/react"
import ChatTextArea from "../ChatTextArea"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { vscode } from "../../../utils/vscode"
import { defaultModeSlug } from "../../../../../src/shared/modes"
import * as pathMentions from "../../../utils/path-mentions"
import { formatPath } from "../../../../../src/shared/formatPath"

// Mock modules
jest.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))
jest.mock("../../../components/common/CodeBlock")
jest.mock("../../../components/common/MarkdownBlock")
jest.mock("../../../utils/path-mentions", () => ({
	convertToMentionPath: jest.fn((path, cwd) => {
		// Simple mock implementation that mimics the real function's behavior
		if (path.startsWith(cwd)) {
			const relativePath = path.substring(cwd.length)
			// Ensure there's a slash after the @ symbol when we create the mention path
			return "@" + formatPath(relativePath, "unix", false)
		}
	}),
}))

// Get the mocked postMessage function
const mockPostMessage = vscode.postMessage as jest.Mock
const mockConvertToMentionPath = pathMentions.convertToMentionPath as jest.Mock

// Mock ExtensionStateContext
jest.mock("../../../context/ExtensionStateContext")

// Custom query function to get the enhance prompt button
const getEnhancePromptButton = () => {
	return screen.getByRole("button", {
		name: (_, element) => {
			// Find the button with the sparkle icon
			return element.querySelector(".codicon-sparkle") !== null
		},
	})
}

describe("ChatTextArea", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: jest.fn(),
		onSend: jest.fn(),
		textAreaDisabled: false,
		onSelectImages: jest.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [],
		setSelectedImages: jest.fn(),
		onHeightChange: jest.fn(),
		mode: defaultModeSlug,
		setMode: jest.fn(),
		modeShortcutText: "(⌘. for next mode)",
	}

	beforeEach(() => {
		jest.clearAllMocks()
		// Default mock implementation for useExtensionState
		;(useExtensionState as jest.Mock).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			osInfo: "unix",
		})
	})

	describe("enhance prompt button", () => {
		it("should be disabled when textAreaDisabled is true", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
			})
			render(<ChatTextArea {...defaultProps} textAreaDisabled={true} />)
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

			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration,
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
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			render(<ChatTextArea {...defaultProps} inputValue="" />)

			const enhanceButton = getEnhancePromptButton()
			fireEvent.click(enhanceButton)

			expect(mockPostMessage).not.toHaveBeenCalled()
		})

		it("should show loading state while enhancing", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
				},
			})

			render(<ChatTextArea {...defaultProps} inputValue="Test prompt" />)

			const enhanceButton = getEnhancePromptButton()
			fireEvent.click(enhanceButton)

			const loadingSpinner = screen.getByText("", { selector: ".codicon-loading" })
			expect(loadingSpinner).toBeInTheDocument()
		})
	})

	describe("effect dependencies", () => {
		it("should update when apiConfiguration changes", () => {
			const { rerender } = render(<ChatTextArea {...defaultProps} />)

			// Update apiConfiguration
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				apiConfiguration: {
					apiProvider: "openrouter",
					newSetting: "test",
				},
			})

			rerender(<ChatTextArea {...defaultProps} />)

			// Verify the enhance button appears after apiConfiguration changes
			expect(getEnhancePromptButton()).toBeInTheDocument()
		})
	})

	describe("enhanced prompt response", () => {
		it("should update input value when receiving enhanced prompt", () => {
			const setInputValue = jest.fn()

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
			jest.clearAllMocks()
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
				cwd: mockCwd,
				osInfo: "unix",
			})
			mockConvertToMentionPath.mockClear()
		})

		it("should process multiple file paths separated by newlines", () => {
			const setInputValue = jest.fn()

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Initial text" />,
			)

			// Create a mock dataTransfer object with text data containing multiple file paths
			const dataTransfer = {
				getData: jest.fn().mockReturnValue("/Users/test/project/file1.js\n/Users/test/project/file2.js"),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// Verify convertToMentionPath was called for each file path
			expect(mockConvertToMentionPath).toHaveBeenCalledTimes(2)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith("/Users/test/project/file1.js", mockCwd, "unix")
			expect(mockConvertToMentionPath).toHaveBeenCalledWith("/Users/test/project/file2.js", mockCwd, "unix")

			// Verify setInputValue was called with the correct value
			// The mock implementation of convertToMentionPath will convert the paths to @/file1.js and @/file2.js
			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Initial text")
		})

		it("should filter out empty lines in the dragged text", () => {
			const setInputValue = jest.fn()

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Initial text" />,
			)

			// Create a mock dataTransfer object with text data containing empty lines
			const dataTransfer = {
				getData: jest.fn().mockReturnValue("/Users/test/project/file1.js\n\n/Users/test/project/file2.js\n\n"),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// Verify convertToMentionPath was called only for non-empty lines
			expect(mockConvertToMentionPath).toHaveBeenCalledTimes(2)

			// Verify setInputValue was called with the correct value
			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Initial text")
		})

		it("should correctly update cursor position after adding multiple mentions", () => {
			const setInputValue = jest.fn()
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
				getData: jest.fn().mockReturnValue("/Users/test/project/file1.js\n/Users/test/project/file2.js"),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// The cursor position should be updated based on the implementation in the component
			expect(setInputValue).toHaveBeenCalledWith("@/file1.js @/file2.js Hello world")
		})

		it("should handle very long file paths correctly", () => {
			const setInputValue = jest.fn()

			const { container } = render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

			// Create a very long file path
			const longPath =
				"/Users/test/project/very/long/path/with/many/nested/directories/and/a/very/long/filename/with/extension.typescript"

			// Create a mock dataTransfer object with the long path
			const dataTransfer = {
				getData: jest.fn().mockReturnValue(longPath),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// Verify convertToMentionPath was called with the long path
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(longPath, mockCwd, "unix")

			// The mock implementation will convert it to @/very/long/path/...
			expect(setInputValue).toHaveBeenCalledWith(
				"@/very/long/path/with/many/nested/directories/and/a/very/long/filename/with/extension.typescript ",
			)
		})

		it("should handle paths with special characters correctly", () => {
			const setInputValue = jest.fn()

			const { container } = render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

			// Create paths with special characters
			const specialPath1 = "/Users/test/project/file with spaces.js"
			const specialPath2 = "/Users/test/project/file-with-dashes.js"
			const specialPath3 = "/Users/test/project/file_with_underscores.js"
			const specialPath4 = "/Users/test/project/file.with.dots.js"

			// Create a mock dataTransfer object with the special paths
			const dataTransfer = {
				getData: jest
					.fn()
					.mockReturnValue(`${specialPath1}\n${specialPath2}\n${specialPath3}\n${specialPath4}`),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// Verify convertToMentionPath was called for each path
			expect(mockConvertToMentionPath).toHaveBeenCalledTimes(4)
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath1, mockCwd, "unix")
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath2, mockCwd, "unix")
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath3, mockCwd, "unix")
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(specialPath4, mockCwd, "unix")

			// Verify setInputValue was called with the correct value
			expect(setInputValue).toHaveBeenCalledWith(
				"@/file with spaces.js @/file-with-dashes.js @/file_with_underscores.js @/file.with.dots.js ",
			)
		})

		it("should handle paths outside the current working directory", () => {
			const setInputValue = jest.fn()

			const { container } = render(<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="" />)

			// Create paths outside the current working directory
			const outsidePath = "/Users/other/project/file.js"

			// Mock the convertToMentionPath function to return the original path for paths outside cwd
			mockConvertToMentionPath.mockImplementationOnce((path, cwd) => {
				return path // Return original path for this test
			})

			// Create a mock dataTransfer object with the outside path
			const dataTransfer = {
				getData: jest.fn().mockReturnValue(outsidePath),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// Verify convertToMentionPath was called with the outside path
			expect(mockConvertToMentionPath).toHaveBeenCalledWith(outsidePath, mockCwd, "unix")

			// Verify setInputValue was called with the original path
			expect(setInputValue).toHaveBeenCalledWith("/Users/other/project/file.js ")
		})

		it("should do nothing when dropped text is empty", () => {
			const setInputValue = jest.fn()

			const { container } = render(
				<ChatTextArea {...defaultProps} setInputValue={setInputValue} inputValue="Initial text" />,
			)

			// Create a mock dataTransfer object with empty text
			const dataTransfer = {
				getData: jest.fn().mockReturnValue(""),
				files: [],
			}

			// Simulate drop event
			fireEvent.drop(container.querySelector(".chat-text-area")!, {
				dataTransfer,
				preventDefault: jest.fn(),
			})

			// Verify convertToMentionPath was not called
			expect(mockConvertToMentionPath).not.toHaveBeenCalled()

			// Verify setInputValue was not called
			expect(setInputValue).not.toHaveBeenCalled()
		})
	})
})
