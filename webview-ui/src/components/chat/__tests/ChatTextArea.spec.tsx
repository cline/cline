import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import ChatTextArea from "../ChatTextArea"
import { ExtensionStateContextProvider } from "../../../context/ExtensionStateContext"

vi.mock("react-textarea-autosize", () => ({
	default: ({
		value,
		onChange,
		...props
	}: {
		value: string
		onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
	}) => <textarea value={value} onChange={onChange} {...props} />,
}))

describe("ChatTextArea", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: vi.fn(),
		textAreaDisabled: false,
		placeholderText: "Type a message...",
		selectedImages: [],
		setSelectedImages: vi.fn(),
		onSend: vi.fn(),
		onSelectImages: vi.fn(),
		shouldDisableImages: false,
		onHeightChange: vi.fn(),
	}

	it("renders the component", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} />
			</ExtensionStateContextProvider>,
		)
		expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument()
	})

	it("calls onSend when Enter is pressed", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} />
			</ExtensionStateContextProvider>,
		)
		const textArea = screen.getByPlaceholderText("Type a message...")
		fireEvent.keyDown(textArea, { key: "Enter", code: "Enter" })
		expect(defaultProps.onSend).toHaveBeenCalled()
	})

	it("calls setInputValue on input change", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} />
			</ExtensionStateContextProvider>,
		)
		const textArea = screen.getByPlaceholderText("Type a message...")
		fireEvent.change(textArea, { target: { value: "Hello" } })
		expect(defaultProps.setInputValue).toHaveBeenCalledWith("Hello")
	})

	it("disables the text area when textAreaDisabled is true", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} textAreaDisabled={true} />
			</ExtensionStateContextProvider>,
		)
		const textArea = screen.getByPlaceholderText("Type a message...")
		expect(textArea).toBeDisabled()
	})

	it("calls onSelectImages when the image button is clicked", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} selectedImages={["image1.png", "image2.png"]} />
			</ExtensionStateContextProvider>,
		)
		const cameraInput = screen.getByTestId("device-camera")
		fireEvent.click(cameraInput)
		expect(defaultProps.onSelectImages).toHaveBeenCalled()
	})

	it("disables the image button when shouldDisableImages is true", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} shouldDisableImages={true} />
			</ExtensionStateContextProvider>,
		)
		const cameraInput = screen.getByTestId("device-camera")
		expect(cameraInput).toHaveClass("disabled")
	})

	it("renders the selected images", () => {
		render(
			<ExtensionStateContextProvider>
				<ChatTextArea {...defaultProps} selectedImages={["image1.png", "image2.png"]} />
			</ExtensionStateContextProvider>,
		)
		expect(screen.getByAltText("Thumbnail 1")).toBeInTheDocument()
		expect(screen.getByAltText("Thumbnail 2")).toBeInTheDocument()
	})
})
