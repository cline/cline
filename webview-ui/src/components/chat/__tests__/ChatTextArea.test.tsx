import { render, fireEvent, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import ChatTextArea from "../ChatTextArea"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { vscode } from "../../../utils/vscode"
import { defaultModeSlug } from "../../../../../src/shared/modes"

// Mock modules
jest.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))
jest.mock("../../../components/common/CodeBlock")
jest.mock("../../../components/common/MarkdownBlock")

// Get the mocked postMessage function
const mockPostMessage = vscode.postMessage as jest.Mock

// Mock ExtensionStateContext
jest.mock("../../../context/ExtensionStateContext")

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
		})
	})

	describe("enhance prompt button", () => {
		it("should be disabled when textAreaDisabled is true", () => {
			;(useExtensionState as jest.Mock).mockReturnValue({
				filePaths: [],
				openedTabs: [],
			})

			render(<ChatTextArea {...defaultProps} textAreaDisabled={true} />)
			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
			expect(enhanceButton).toHaveClass("disabled")
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

			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
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

			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
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

			const enhanceButton = screen.getByRole("button", { name: /enhance prompt/i })
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
			expect(screen.getByRole("button", { name: /enhance prompt/i })).toBeInTheDocument()
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
})
