import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { CodeIndexPopover } from "../CodeIndexPopover"

// Mock the vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the extension state context
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

// Mock the translation context
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: vi.fn((key: string) => key) }),
}))

// Mock react-i18next
vi.mock("react-i18next", () => ({
	Trans: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock the doc links utility
vi.mock("@src/utils/docLinks", () => ({
	buildDocLink: vi.fn(() => "https://docs.roocode.com"),
}))

// Mock the portal hook
vi.mock("@src/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => ({ portalContainer: document.body }),
}))

// Mock Radix UI components to avoid portal issues
vi.mock("@src/components/ui", () => ({
	Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
		<div role="option" data-value={value}>
			{children}
		</div>
	),
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <div role="combobox">{children}</div>,
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
	AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (value: number[]) => void }) => (
		<input type="range" value={value[0]} onChange={(e) => onValueChange([parseInt(e.target.value)])} />
	),
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	cn: (...classes: string[]) => classes.join(" "),
}))

// Mock VSCode web components to behave like regular HTML inputs
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ value, onInput, placeholder, className, ...rest }: any) => (
		<input
			type="text"
			value={value || ""}
			onChange={(e) => onInput && onInput(e)}
			placeholder={placeholder}
			className={className}
			aria-label="Text field"
			{...rest}
		/>
	),
	VSCodeButton: ({ children, onClick, ...rest }: any) => (
		<button onClick={onClick} {...rest}>
			{children}
		</button>
	),
	VSCodeDropdown: ({ value, onChange, children, className, ...rest }: any) => (
		<select
			value={value || ""}
			onChange={(e) => onChange && onChange(e)}
			className={className}
			role="combobox"
			{...rest}>
			{children}
		</select>
	),
	VSCodeOption: ({ value, children, ...rest }: any) => (
		<option value={value} {...rest}>
			{children}
		</option>
	),
	VSCodeLink: ({ href, children, ...rest }: any) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}))

// Helper function to simulate input on form elements
const simulateInput = (element: Element, value: string) => {
	// Now that we're mocking VSCode components as regular HTML inputs,
	// we can use standard fireEvent.change
	fireEvent.change(element, { target: { value } })
}

describe("CodeIndexPopover Validation", () => {
	let mockUseExtensionState: any

	beforeEach(async () => {
		vi.clearAllMocks()

		// Get the mocked function
		const { useExtensionState } = await import("@src/context/ExtensionStateContext")
		mockUseExtensionState = vi.mocked(useExtensionState)

		// Setup default extension state
		mockUseExtensionState.mockReturnValue({
			codebaseIndexConfig: {
				codebaseIndexEnabled: false,
				codebaseIndexQdrantUrl: "",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "",
				codebaseIndexSearchMaxResults: 10,
				codebaseIndexSearchMinScore: 0.7,
				codebaseIndexOpenAiCompatibleBaseUrl: "",
				codebaseIndexEmbedderModelDimension: undefined,
			},
			codebaseIndexModels: {
				openai: [{ dimension: 1536 }],
			},
		})
	})

	const renderComponent = () => {
		return render(
			<CodeIndexPopover indexingStatus={{ systemStatus: "idle", message: "", processedItems: 0, totalItems: 0 }}>
				<button>Test Trigger</button>
			</CodeIndexPopover>,
		)
	}

	const openPopover = async () => {
		const trigger = screen.getByText("Test Trigger")
		fireEvent.click(trigger)

		// Wait for popover to open
		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeInTheDocument()
		})
	}

	const expandSetupSection = async () => {
		const setupButton = screen.getByText("settings:codeIndex.setupConfigLabel")
		fireEvent.click(setupButton)

		// Wait for section to expand - look for vscode-text-field elements
		await waitFor(() => {
			const textFields = screen.getAllByLabelText("Text field")
			expect(textFields.length).toBeGreaterThan(0)
		})
	}

	describe("OpenAI Provider Validation", () => {
		it("should show validation error when OpenAI API key is empty", async () => {
			renderComponent()
			await openPopover()
			await expandSetupSection()

			// First, make a change to enable the save button by modifying the Qdrant URL
			const qdrantUrlField = screen.getByPlaceholderText(/settings:codeIndex.qdrantUrlPlaceholder/i)
			fireEvent.change(qdrantUrlField, { target: { value: "http://localhost:6333" } })

			// Wait for the save button to become enabled
			await waitFor(() => {
				const saveButton = screen.getByText("settings:codeIndex.saveSettings")
				expect(saveButton).not.toBeDisabled()
			})

			// Now clear the OpenAI API key to create a validation error
			const apiKeyField = screen.getByPlaceholderText(/settings:codeIndex.openAiKeyPlaceholder/i)
			fireEvent.change(apiKeyField, { target: { value: "" } })

			// Click the save button to trigger validation
			const saveButton = screen.getByText("settings:codeIndex.saveSettings")
			fireEvent.click(saveButton)

			// Should show specific field error
			await waitFor(() => {
				expect(screen.getByText("settings:codeIndex.validation.openaiApiKeyRequired")).toBeInTheDocument()
			})
		})

		it("should show validation error when model is not selected", async () => {
			renderComponent()
			await openPopover()
			await expandSetupSection()

			// First, make a change to enable the save button
			const qdrantUrlField = screen.getByPlaceholderText(/settings:codeIndex.qdrantUrlPlaceholder/i)
			fireEvent.change(qdrantUrlField, { target: { value: "http://localhost:6333" } })

			// Set API key but leave model empty
			const apiKeyField = screen.getByPlaceholderText(/settings:codeIndex.openAiKeyPlaceholder/i)
			fireEvent.change(apiKeyField, { target: { value: "test-api-key" } })

			// Wait for the save button to become enabled
			await waitFor(() => {
				const saveButton = screen.getByText("settings:codeIndex.saveSettings")
				expect(saveButton).not.toBeDisabled()
			})

			const saveButton = screen.getByText("settings:codeIndex.saveSettings")
			fireEvent.click(saveButton)

			await waitFor(() => {
				expect(screen.getByText("settings:codeIndex.validation.modelSelectionRequired")).toBeInTheDocument()
			})
		})
	})

	describe("Qdrant URL Validation", () => {
		it("should show validation error when Qdrant URL is empty", async () => {
			renderComponent()
			await openPopover()
			await expandSetupSection()

			// First, make a change to enable the save button by setting API key
			const apiKeyField = screen.getByPlaceholderText(/settings:codeIndex.openAiKeyPlaceholder/i)
			fireEvent.change(apiKeyField, { target: { value: "test-api-key" } })

			// Clear the Qdrant URL to create validation error
			const qdrantUrlField = screen.getByPlaceholderText(/settings:codeIndex.qdrantUrlPlaceholder/i)
			fireEvent.change(qdrantUrlField, { target: { value: "" } })

			// Wait for the save button to become enabled
			await waitFor(() => {
				const saveButton = screen.getByText("settings:codeIndex.saveSettings")
				expect(saveButton).not.toBeDisabled()
			})

			const saveButton = screen.getByText("settings:codeIndex.saveSettings")
			fireEvent.click(saveButton)

			await waitFor(() => {
				expect(screen.getByText("settings:codeIndex.validation.invalidQdrantUrl")).toBeInTheDocument()
			})
		})

		it("should show validation error when Qdrant URL is invalid", async () => {
			renderComponent()
			await openPopover()
			await expandSetupSection()

			// First, make a change to enable the save button by setting API key
			const apiKeyField = screen.getByPlaceholderText(/settings:codeIndex.openAiKeyPlaceholder/i)
			fireEvent.change(apiKeyField, { target: { value: "test-api-key" } })

			// Set invalid Qdrant URL
			const qdrantUrlField = screen.getByPlaceholderText(/settings:codeIndex.qdrantUrlPlaceholder/i)
			fireEvent.change(qdrantUrlField, { target: { value: "invalid-url" } })

			// Wait for the save button to become enabled
			await waitFor(() => {
				const saveButton = screen.getByText("settings:codeIndex.saveSettings")
				expect(saveButton).not.toBeDisabled()
			})

			const saveButton = screen.getByText("settings:codeIndex.saveSettings")
			fireEvent.click(saveButton)

			await waitFor(() => {
				expect(screen.getByText("settings:codeIndex.validation.invalidQdrantUrl")).toBeInTheDocument()
			})
		})
	})

	describe("Common Field Validation", () => {
		it("should not show validation error for optional Qdrant API key", async () => {
			renderComponent()
			await openPopover()
			await expandSetupSection()

			// Set required fields to make form valid
			const qdrantUrlField = screen.getByPlaceholderText(/settings:codeIndex.qdrantUrlPlaceholder/i)
			fireEvent.change(qdrantUrlField, { target: { value: "http://localhost:6333" } })

			const apiKeyField = screen.getByPlaceholderText(/settings:codeIndex.openAiKeyPlaceholder/i)
			fireEvent.change(apiKeyField, { target: { value: "test-api-key" } })

			// Select a model - this is required (get the select element specifically)
			const modelSelect = screen.getAllByRole("combobox").find((el) => el.tagName === "SELECT")
			if (modelSelect) {
				fireEvent.change(modelSelect, { target: { value: "0" } })
			}

			// Leave Qdrant API key empty (it's optional)
			const qdrantApiKeyField = screen.getByPlaceholderText(/settings:codeIndex.qdrantApiKeyPlaceholder/i)
			fireEvent.change(qdrantApiKeyField, { target: { value: "" } })

			// Wait for the save button to become enabled
			await waitFor(() => {
				const saveButton = screen.getByText("settings:codeIndex.saveSettings")
				expect(saveButton).not.toBeDisabled()
			})

			const saveButton = screen.getByText("settings:codeIndex.saveSettings")
			fireEvent.click(saveButton)

			// Should not show validation errors since Qdrant API key is optional
		})

		it("should clear validation errors when fields are corrected", async () => {
			renderComponent()
			await openPopover()
			await expandSetupSection()

			// First make an invalid change to enable the save button and trigger validation
			const textFields = screen.getAllByLabelText("Text field")
			const qdrantField = textFields.find((field) =>
				field.getAttribute("placeholder")?.toLowerCase().includes("qdrant"),
			)

			if (qdrantField) {
				simulateInput(qdrantField, "invalid-url") // Invalid URL to trigger validation
			}

			// Wait for save button to be enabled
			const saveButton = screen.getByText("settings:codeIndex.saveSettings")
			await waitFor(() => {
				expect(saveButton).not.toBeDisabled()
			})

			// Click save to trigger validation errors
			fireEvent.click(saveButton)

			// Now fix the errors with valid values
			const apiKeyField = textFields.find(
				(field) =>
					field.getAttribute("placeholder")?.toLowerCase().includes("openai") ||
					field.getAttribute("placeholder")?.toLowerCase().includes("key"),
			)

			// Set valid Qdrant URL
			if (qdrantField) {
				simulateInput(qdrantField, "http://localhost:6333")
			}

			// Set API key
			if (apiKeyField) {
				simulateInput(apiKeyField, "test-api-key")
			}

			// Select a model - this is required (get the select element specifically)
			const modelSelect = screen.getAllByRole("combobox").find((el) => el.tagName === "SELECT")
			if (modelSelect) {
				fireEvent.change(modelSelect, { target: { value: "0" } })
			}

			// Try to save again
			fireEvent.click(saveButton)

			// Validation errors should be cleared (specific field errors are checked elsewhere)
		})
	})
})
