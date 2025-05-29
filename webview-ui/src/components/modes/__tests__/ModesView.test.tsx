// npx jest src/components/prompts/__tests__/PromptsView.test.tsx

import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import ModesView from "../ModesView"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

// Mock vscode API
jest.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

const mockExtensionState = {
	customModePrompts: {},
	listApiConfigMeta: [
		{ id: "config1", name: "Config 1" },
		{ id: "config2", name: "Config 2" },
	],
	enhancementApiConfigId: "",
	setEnhancementApiConfigId: jest.fn(),
	mode: "code",
	customModes: [],
	customSupportPrompts: [],
	currentApiConfigName: "",
	customInstructions: "Initial instructions",
	setCustomInstructions: jest.fn(),
}

const renderPromptsView = (props = {}) => {
	const mockOnDone = jest.fn()
	return render(
		<ExtensionStateContext.Provider value={{ ...mockExtensionState, ...props } as any}>
			<ModesView onDone={mockOnDone} />
		</ExtensionStateContext.Provider>,
	)
}

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

Element.prototype.scrollIntoView = jest.fn()

describe("PromptsView", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("displays the current mode name in the select trigger", () => {
		renderPromptsView({ mode: "code" })
		const selectTrigger = screen.getByTestId("mode-select-trigger")
		expect(selectTrigger).toHaveTextContent("Code")
	})

	it("opens the mode selection popover when the trigger is clicked", async () => {
		renderPromptsView()
		const selectTrigger = screen.getByTestId("mode-select-trigger")
		fireEvent.click(selectTrigger)
		await waitFor(() => {
			expect(selectTrigger).toHaveAttribute("aria-expanded", "true")
		})
	})

	it("filters mode options based on search input", async () => {
		renderPromptsView()
		const selectTrigger = screen.getByTestId("mode-select-trigger")
		fireEvent.click(selectTrigger)

		const searchInput = screen.getByTestId("mode-search-input")
		fireEvent.change(searchInput, { target: { value: "ask" } })

		await waitFor(() => {
			expect(screen.getByTestId("mode-option-ask")).toBeInTheDocument()
			expect(screen.queryByTestId("mode-option-code")).not.toBeInTheDocument()
			expect(screen.queryByTestId("mode-option-architect")).not.toBeInTheDocument()
		})
	})

	it("selects a mode from the dropdown and sends update message", async () => {
		renderPromptsView()
		const selectTrigger = screen.getByTestId("mode-select-trigger")
		fireEvent.click(selectTrigger)

		const askOption = await waitFor(() => screen.getByTestId("mode-option-ask"))
		fireEvent.click(askOption)

		expect(mockExtensionState.setEnhancementApiConfigId).not.toHaveBeenCalled() // Ensure this is not called by mode switch
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "mode",
			text: "ask",
		})
		await waitFor(() => {
			expect(selectTrigger).toHaveAttribute("aria-expanded", "false")
		})
	})

	it("handles prompt changes correctly", async () => {
		renderPromptsView()

		// Get the textarea
		const textarea = await waitFor(() => screen.getByTestId("code-prompt-textarea"))
		fireEvent.change(textarea, {
			target: { value: "New prompt value" },
		})

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: { roleDefinition: "New prompt value" },
		})
	})

	it("resets role definition only for built-in modes", async () => {
		const customMode = {
			slug: "custom-mode",
			name: "Custom Mode",
			roleDefinition: "Custom role",
			groups: [],
		}

		// Test with built-in mode (code)
		const { unmount } = render(
			<ExtensionStateContext.Provider
				value={{ ...mockExtensionState, mode: "code", customModes: [customMode] } as any}>
				<ModesView onDone={jest.fn()} />
			</ExtensionStateContext.Provider>,
		)

		// Find and click the role definition reset button
		const resetButton = screen.getByTestId("role-definition-reset")
		expect(resetButton).toBeInTheDocument()
		await fireEvent.click(resetButton)

		// Verify it only resets role definition
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: { roleDefinition: undefined },
		})

		// Cleanup before testing custom mode
		unmount()

		// Test with custom mode
		render(
			<ExtensionStateContext.Provider
				value={{ ...mockExtensionState, mode: "custom-mode", customModes: [customMode] } as any}>
				<ModesView onDone={jest.fn()} />
			</ExtensionStateContext.Provider>,
		)

		// Verify reset button is not present for custom mode
		expect(screen.queryByTestId("role-definition-reset")).not.toBeInTheDocument()
	})

	it("handles clearing custom instructions correctly", async () => {
		const setCustomInstructions = jest.fn()
		renderPromptsView({
			...mockExtensionState,
			customInstructions: "Initial instructions",
			setCustomInstructions,
		})

		const textarea = screen.getByTestId("global-custom-instructions-textarea")
		fireEvent.change(textarea, {
			target: { value: "" },
		})

		expect(setCustomInstructions).toHaveBeenCalledWith(undefined)
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "customInstructions",
			text: undefined,
		})
	})
})
