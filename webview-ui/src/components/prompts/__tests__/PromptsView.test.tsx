import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"
import PromptsView from "../PromptsView"
import { ExtensionStateContext } from "../../../context/ExtensionStateContext"
import { vscode } from "../../../utils/vscode"

// Mock vscode API
jest.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

const mockExtensionState = {
	customPrompts: {},
	listApiConfigMeta: [
		{ id: "config1", name: "Config 1" },
		{ id: "config2", name: "Config 2" },
	],
	enhancementApiConfigId: "",
	setEnhancementApiConfigId: jest.fn(),
	mode: "code",
	customInstructions: "Initial instructions",
	setCustomInstructions: jest.fn(),
}

const renderPromptsView = (props = {}) => {
	const mockOnDone = jest.fn()
	return render(
		<ExtensionStateContext.Provider value={{ ...mockExtensionState, ...props } as any}>
			<PromptsView onDone={mockOnDone} />
		</ExtensionStateContext.Provider>,
	)
}

describe("PromptsView", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders all mode tabs", () => {
		renderPromptsView()
		expect(screen.getByTestId("code-tab")).toBeInTheDocument()
		expect(screen.getByTestId("ask-tab")).toBeInTheDocument()
		expect(screen.getByTestId("architect-tab")).toBeInTheDocument()
	})

	it("defaults to current mode as active tab", () => {
		renderPromptsView({ mode: "ask" })

		const codeTab = screen.getByTestId("code-tab")
		const askTab = screen.getByTestId("ask-tab")
		const architectTab = screen.getByTestId("architect-tab")

		expect(askTab).toHaveAttribute("data-active", "true")
		expect(codeTab).toHaveAttribute("data-active", "false")
		expect(architectTab).toHaveAttribute("data-active", "false")
	})

	it("switches between tabs correctly", () => {
		renderPromptsView({ mode: "code" })

		const codeTab = screen.getByTestId("code-tab")
		const askTab = screen.getByTestId("ask-tab")
		const architectTab = screen.getByTestId("architect-tab")

		// Initial state matches current mode (code)
		expect(codeTab).toHaveAttribute("data-active", "true")
		expect(askTab).toHaveAttribute("data-active", "false")
		expect(architectTab).toHaveAttribute("data-active", "false")
		expect(architectTab).toHaveAttribute("data-active", "false")

		// Click Ask tab
		fireEvent.click(askTab)
		expect(askTab).toHaveAttribute("data-active", "true")
		expect(codeTab).toHaveAttribute("data-active", "false")
		expect(architectTab).toHaveAttribute("data-active", "false")

		// Click Architect tab
		fireEvent.click(architectTab)
		expect(architectTab).toHaveAttribute("data-active", "true")
		expect(askTab).toHaveAttribute("data-active", "false")
		expect(codeTab).toHaveAttribute("data-active", "false")
	})

	it("handles prompt changes correctly", () => {
		renderPromptsView()

		const textarea = screen.getByTestId("code-prompt-textarea")
		fireEvent(
			textarea,
			new CustomEvent("change", {
				detail: {
					target: {
						value: "New prompt value",
					},
				},
			}),
		)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: { roleDefinition: "New prompt value" },
		})
	})

	it("resets prompt to default value", () => {
		renderPromptsView()

		const resetButton = screen.getByTestId("reset-prompt-button")
		fireEvent.click(resetButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: { roleDefinition: undefined },
		})
	})

	it("handles API configuration selection", () => {
		renderPromptsView()

		const dropdown = screen.getByTestId("api-config-dropdown")
		fireEvent(
			dropdown,
			new CustomEvent("change", {
				detail: {
					target: {
						value: "config1",
					},
				},
			}),
		)

		expect(mockExtensionState.setEnhancementApiConfigId).toHaveBeenCalledWith("config1")
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "enhancementApiConfigId",
			text: "config1",
		})
	})

	it("handles clearing custom instructions correctly", async () => {
		const setCustomInstructions = jest.fn()
		renderPromptsView({
			...mockExtensionState,
			customInstructions: "Initial instructions",
			setCustomInstructions,
		})

		const textarea = screen.getByTestId("global-custom-instructions-textarea")
		const changeEvent = new CustomEvent("change", {
			detail: { target: { value: "" } },
		})
		Object.defineProperty(changeEvent, "target", {
			value: { value: "" },
		})
		await fireEvent(textarea, changeEvent)

		expect(setCustomInstructions).toHaveBeenCalledWith(undefined)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "customInstructions",
			text: undefined,
		})
	})
})
