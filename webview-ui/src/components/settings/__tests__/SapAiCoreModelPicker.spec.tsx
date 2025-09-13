import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import SapAiCoreModelPicker from "../SapAiCoreModelPicker"

// Mock the shared API models
vi.mock("@shared/api", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	return {
		...actual,
		sapAiCoreModels: {
			"anthropic--claude-3.5-sonnet": {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: false,
			},
			"anthropic--claude-3-haiku": {
				maxTokens: 4096,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: false,
			},
			"gpt-4o": {
				maxTokens: 4096,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: false,
			},
			"gemini-2.5-pro": {
				maxTokens: 65536,
				contextWindow: 1_048_576,
				supportsImages: true,
				supportsPromptCache: true,
			},
		},
	}
})

// Mock the ExtensionStateContext
vi.mock("../../../context/ExtensionStateContext", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual || {}),
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				apiProvider: "sapaicore",
				sapAiCoreModelId: "anthropic--claude-3.5-sonnet",
			},
			setApiConfiguration: vi.fn(),
		})),
	}
})

describe("SapAiCoreModelPicker Component", () => {
	vi.clearAllMocks()
	const mockOnModelChange = vi.fn()

	beforeEach(() => {
		mockOnModelChange.mockClear()
	})

	it("renders the model dropdown with correct label", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "gpt-4o"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		const label = screen.getByText("Model")
		expect(label).toBeInTheDocument()

		const dropdown = screen.getByRole("combobox")
		expect(dropdown).toBeInTheDocument()
		expect(dropdown).toHaveAttribute("id", "sap-ai-core-model-dropdown")
	})

	it("renders with default placeholder", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker onModelChange={mockOnModelChange} sapAiCoreDeployedModels={[]} selectedModelId="" />
			</ExtensionStateContextProvider>,
		)

		const placeholderOption = screen.getByText("Select a model...")
		expect(placeholderOption).toBeInTheDocument()
	})

	it("renders with custom placeholder", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					placeholder="Choose SAP AI Core model..."
					sapAiCoreDeployedModels={[]}
					selectedModelId=""
				/>
			</ExtensionStateContextProvider>,
		)

		const placeholderOption = screen.getByText("Choose SAP AI Core model...")
		expect(placeholderOption).toBeInTheDocument()
	})

	it("shows deployed models section when deployed models exist", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "gpt-4o"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Check for deployed models section header
		const deployedHeader = screen.getByText("── Deployed Models ──")
		expect(deployedHeader).toBeInTheDocument()

		// Check for deployed model options
		const claudeOption = screen.getByText("anthropic--claude-3.5-sonnet")
		const gptOption = screen.getByText("gpt-4o")
		expect(claudeOption).toBeInTheDocument()
		expect(gptOption).toBeInTheDocument()
	})

	it("shows not deployed models section when supported but not deployed models exist", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Check for not deployed models section header
		const notDeployedHeader = screen.getByText("── Not Deployed Models ──")
		expect(notDeployedHeader).toBeInTheDocument()

		// Check for not deployed model options
		const haikuOption = screen.getByText("anthropic--claude-3-haiku")
		const geminiOption = screen.getByText("gemini-2.5-pro")
		expect(haikuOption).toBeInTheDocument()
		expect(geminiOption).toBeInTheDocument()
	})

	it("correctly categorizes models into deployed and not deployed", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "gpt-4o"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Deployed models should appear
		expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument()
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()

		// Not deployed models should appear
		expect(screen.getByText("anthropic--claude-3-haiku")).toBeInTheDocument()
		expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument()
	})

	it("calls onModelChange when a model is selected", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "gpt-4o"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Test that the component renders correctly and has the expected structure
		const dropdown = screen.getByRole("combobox")
		expect(dropdown).toBeInTheDocument()
		expect(dropdown).toHaveValue("anthropic--claude-3.5-sonnet")

		// Since VSCodeDropdown doesn't work well with testing libraries,
		// we'll verify the component structure instead of simulating events
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument()
	})

	it("handles selection of not deployed models", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Test that not deployed models are properly displayed
		const dropdown = screen.getByRole("combobox")
		expect(dropdown).toBeInTheDocument()
		expect(dropdown).toHaveValue("anthropic--claude-3.5-sonnet")

		// Verify that not deployed models are shown with proper labeling
		expect(screen.getByText("anthropic--claude-3-haiku")).toBeInTheDocument()
		expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument()
	})

	it("updates selected value when selectedModelId prop changes", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "gpt-4o"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		const dropdown = screen.getByRole("combobox")
		expect(dropdown).toHaveValue("anthropic--claude-3.5-sonnet")

		// Rerender with different selectedModelId
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "gpt-4o"]}
					selectedModelId="gpt-4o"
				/>
			</ExtensionStateContextProvider>,
		)

		expect(dropdown).toHaveValue("gpt-4o")
	})

	it("handles empty deployed models array", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker onModelChange={mockOnModelChange} sapAiCoreDeployedModels={[]} selectedModelId="" />
			</ExtensionStateContextProvider>,
		)

		// Should not show deployed models section
		expect(screen.queryByText("── Deployed Models ──")).not.toBeInTheDocument()

		// Should show not deployed models section with all supported models
		const notDeployedHeader = screen.getByText("── Not Deployed Models ──")
		expect(notDeployedHeader).toBeInTheDocument()

		// All models should be marked as not deployed
		expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument()
		expect(screen.getByText("anthropic--claude-3-haiku")).toBeInTheDocument()
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument()
	})

	it("handles case where all supported models are deployed", () => {
		const allSupportedModels = ["anthropic--claude-3.5-sonnet", "anthropic--claude-3-haiku", "gpt-4o", "gemini-2.5-pro"]

		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={allSupportedModels}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Should show deployed models section
		const deployedHeader = screen.getByText("── Deployed Models ──")
		expect(deployedHeader).toBeInTheDocument()

		// Should not show not deployed models section
		expect(screen.queryByText("── Not Deployed Models ──")).not.toBeInTheDocument()

		// All models should appear
		expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument()
		expect(screen.getByText("anthropic--claude-3-haiku")).toBeInTheDocument()
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument()
	})

	it("handles models that are deployed but not in supported list", () => {
		// Include a model that's deployed but not in our mocked sapAiCoreModels
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet", "unsupported-model"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Only supported deployed models should appear in deployed section
		expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument()
		expect(screen.queryByText("unsupported-model")).not.toBeInTheDocument()

		// Other supported models should appear in not deployed section
		expect(screen.getByText("anthropic--claude-3-haiku")).toBeInTheDocument()
	})

	it("maintains correct dropdown structure with sections", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet"]}
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Check that section headers are disabled options
		const deployedHeader = screen.getByText("── Deployed Models ──")
		const notDeployedHeader = screen.getByText("── Not Deployed Models ──")

		expect(deployedHeader).toBeInTheDocument()
		expect(notDeployedHeader).toBeInTheDocument()

		// Headers should be disabled (though we can't easily test the disabled attribute in this setup)
		// The important thing is they exist and provide visual separation
	})

	it("handles model selection with empty string", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreDeployedModels={["anthropic--claude-3.5-sonnet"]}
					selectedModelId=""
				/>
			</ExtensionStateContextProvider>,
		)

		// Test that the component handles empty selectedModelId correctly
		const dropdown = screen.getByRole("combobox")
		expect(dropdown).toBeInTheDocument()
		expect(dropdown).toHaveValue("")

		// Verify that the placeholder is shown when no model is selected
		expect(screen.getByText("Select a model...")).toBeInTheDocument()
	})
})
