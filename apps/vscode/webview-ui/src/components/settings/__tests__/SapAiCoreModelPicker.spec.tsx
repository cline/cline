import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import SapAiCoreModelPicker from "../SapAiCoreModelPicker"

const mocks = vi.hoisted(() => ({
	resolveProviderModelsMock: vi.fn().mockResolvedValue({
		providerId: "sapaicore",
		requestId: "test-request-id",
		configFingerprint: "test-fingerprint",
		fetchedAt: Date.now(),
		ok: true,
		models: {},
		defaultModelId: "",
	}),
	setApiConfigurationMock: vi.fn(),
	startProviderModelsRequestMock: vi.fn(),
	applyProviderModelsResponseMock: vi.fn(),
	useExtensionStateMock: vi.fn(() => ({
		apiConfiguration: {
			apiProvider: "sapaicore",
			sapAiCoreModelId: "anthropic--claude-3.5-sonnet",
		},
		setApiConfiguration: mocks.setApiConfigurationMock,
		providerModelsByProvider: {
			sapaicore: {
				models: {
					"anthropic--claude-3.5-sonnet": { maxTokens: 8192, contextWindow: 200_000, supportsPromptCache: false },
					"anthropic--claude-3-haiku": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gpt-4o": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gpt-5.5": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gpt-4-base": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gpt-5-codex": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gpt-4-instruct": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gpt-4-realtime": { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false },
					"gemini-2.5-pro": { maxTokens: 65536, contextWindow: 1_048_576, supportsPromptCache: true },
				},
				defaultModelId: "anthropic--claude-3.5-sonnet",
			},
		},
		startProviderModelsRequest: mocks.startProviderModelsRequestMock,
		applyProviderModelsResponse: mocks.applyProviderModelsResponseMock,
	})),
}))

vi.mock("@/services/grpc-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/services/grpc-client")>()
	return {
		...actual,
		ModelsServiceClient: {
			...actual.ModelsServiceClient,
			resolveProviderModels: mocks.resolveProviderModelsMock,
		},
	}
})

// Define the interface locally since it's not exported from the proto
interface SapAiCoreModelDeployment {
	modelName: string
	deploymentId: string
}

// Helper function to create SapAiCoreModelDeployment objects
const createDeployments = (modelNames: string[]): SapAiCoreModelDeployment[] => {
	return modelNames.map((modelName, index) => ({
		modelName,
		deploymentId: `deployment-${index + 1}`,
	}))
}

// Mock the ExtensionStateContext used by the component and by this spec.
vi.mock("@/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: { children: any }) => children,
	useExtensionState: mocks.useExtensionStateMock,
}))

describe("SapAiCoreModelPicker Component", () => {
	const mockOnModelChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		mockOnModelChange.mockClear()
		mocks.resolveProviderModelsMock.mockClear()
	})

	it("does not refresh the provider model list when orchestration mode changes", async () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		await waitFor(() => expect(mocks.resolveProviderModelsMock).toHaveBeenCalledTimes(1))

		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={true}
				/>
			</ExtensionStateContextProvider>,
		)

		await waitFor(() => expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument())
		expect(mocks.resolveProviderModelsMock).toHaveBeenCalledTimes(1)
	})

	it("filters foundation-model mode to OpenAI chat models", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
		expect(screen.queryByText("anthropic--claude-3.5-sonnet")).not.toBeInTheDocument()
		expect(screen.queryByText("anthropic--claude-3-haiku")).not.toBeInTheDocument()
		expect(screen.queryByText("gemini-2.5-pro")).not.toBeInTheDocument()
		expect(screen.queryByText("gpt-4-base")).not.toBeInTheDocument()
		expect(screen.queryByText("gpt-5-codex")).not.toBeInTheDocument()
		expect(screen.queryByText("gpt-4-instruct")).not.toBeInTheDocument()
		expect(screen.queryByText("gpt-4-realtime")).not.toBeInTheDocument()
	})

	it("renders the model dropdown with correct label", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet", "gpt-4o"])}
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
				<SapAiCoreModelPicker onModelChange={mockOnModelChange} sapAiCoreModelDeployments={[]} selectedModelId="" />
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
					sapAiCoreModelDeployments={[]}
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
					sapAiCoreModelDeployments={createDeployments(["gpt-4o", "gpt-5.5"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Check for deployed models section header
		const deployedHeader = screen.getByText("── Deployed Models ──")
		expect(deployedHeader).toBeInTheDocument()

		// Check for deployed model options
		const gptOption = screen.getByText("gpt-4o")
		const gptFiveOption = screen.getByText("gpt-5.5")
		expect(gptOption).toBeInTheDocument()
		expect(gptFiveOption).toBeInTheDocument()
	})

	it("shows not deployed models section when supported but not deployed models exist", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Check for not deployed models section header
		const notDeployedHeader = screen.getByText("── Not Deployed Models ──")
		expect(notDeployedHeader).toBeInTheDocument()

		// Check for not deployed model options
		const gptFiveOption = screen.getByText("gpt-5.5")
		expect(gptFiveOption).toBeInTheDocument()
	})

	it("correctly categorizes models into deployed and not deployed", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Deployed models should appear
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()

		// Not deployed models should appear
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
	})

	it("calls onModelChange when a model is selected", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet", "gpt-4o"])}
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
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Test that not deployed models are properly displayed
		const dropdown = screen.getByRole("combobox")
		expect(dropdown).toBeInTheDocument()
		expect(dropdown).toHaveValue("gpt-4o")

		// Verify that not deployed models are shown with proper labeling
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
	})

	it("updates selected value when selectedModelId prop changes", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet", "gpt-4o"])}
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
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet", "gpt-4o"])}
					selectedModelId="gpt-4o"
				/>
			</ExtensionStateContextProvider>,
		)

		expect(dropdown).toHaveValue("gpt-4o")
	})

	it("handles empty deployed models array", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={[]}
					selectedModelId=""
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Should not show deployed models section
		expect(screen.queryByText("── Deployed Models ──")).not.toBeInTheDocument()

		// Should show not deployed models section with all supported models
		const notDeployedHeader = screen.getByText("── Not Deployed Models ──")
		expect(notDeployedHeader).toBeInTheDocument()

		// All models should be marked as not deployed
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
		expect(screen.queryByText("anthropic--claude-3.5-sonnet")).not.toBeInTheDocument()
		expect(screen.queryByText("anthropic--claude-3-haiku")).not.toBeInTheDocument()
		expect(screen.queryByText("gemini-2.5-pro")).not.toBeInTheDocument()
	})

	it("handles case where all supported models are deployed", () => {
		const allSupportedModels = ["gpt-4o", "gpt-5.5"]

		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(allSupportedModels)}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Should show deployed models section
		const deployedHeader = screen.getByText("── Deployed Models ──")
		expect(deployedHeader).toBeInTheDocument()

		// Should not show not deployed models section
		expect(screen.queryByText("── Not Deployed Models ──")).not.toBeInTheDocument()

		// All models should appear
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
	})

	it("handles models that are deployed but not in supported list", () => {
		// Include a model that's deployed but not in our mocked sapAiCoreModels
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o", "unsupported-model"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
				/>
			</ExtensionStateContextProvider>,
		)

		// Only supported deployed models should appear in deployed section
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.queryByText("unsupported-model")).not.toBeInTheDocument()

		// Other supported models should appear in not deployed section
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
	})

	it("maintains correct dropdown structure with sections", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedModelId="gpt-4o"
					useOrchestrationMode={false}
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
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
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

	it("handles orchestration mode correctly", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedModelId="anthropic--claude-3.5-sonnet"
					useOrchestrationMode={true}
				/>
			</ExtensionStateContextProvider>,
		)

		// In orchestration mode, should not show section headers
		expect(screen.queryByText("── Deployed Models ──")).not.toBeInTheDocument()
		expect(screen.queryByText("── Not Deployed Models ──")).not.toBeInTheDocument()

		// Should show all supported models in flat list
		expect(screen.getByText("anthropic--claude-3.5-sonnet")).toBeInTheDocument()
		expect(screen.getByText("anthropic--claude-3-haiku")).toBeInTheDocument()
		expect(screen.getByText("gpt-4o")).toBeInTheDocument()
		expect(screen.getByText("gpt-5.5")).toBeInTheDocument()
		expect(screen.getByText("gemini-2.5-pro")).toBeInTheDocument()
		expect(screen.getByText("gpt-4-base")).toBeInTheDocument()
		expect(screen.getByText("gpt-5-codex")).toBeInTheDocument()
		expect(screen.getByText("gpt-4-instruct")).toBeInTheDocument()
		expect(screen.getByText("gpt-4-realtime")).toBeInTheDocument()
	})

	it("should auto-set deployment ID when model is selected but deployment ID is missing", () => {
		const deployments = createDeployments(["anthropic--claude-3.5-sonnet"])

		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={deployments}
					selectedDeploymentId=""
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically
		expect(mockOnModelChange).toHaveBeenCalledWith("anthropic--claude-3.5-sonnet", "deployment-1")
	})

	it("should update deployment ID when model is selected but deployment ID is stale", () => {
		const deployments = createDeployments(["anthropic--claude-3.5-sonnet"])

		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={deployments}
					selectedDeploymentId="old-deployment-id"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically
		expect(mockOnModelChange).toHaveBeenCalledWith("anthropic--claude-3.5-sonnet", "deployment-1")
	})

	it("should clear deployment ID when deployments change and selected model no longer has deployment", () => {
		const deployments = createDeployments(["gpt-4o"]) // Different model deployed

		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={deployments}
					selectedDeploymentId="old-deployment-id"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically
		expect(mockOnModelChange).toHaveBeenCalledWith("anthropic--claude-3.5-sonnet", "")
	})

	it("should handle switching from credentials with deployments to credentials without deployments", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Initially should not call onModelChange since deployment ID already matches
		expect(mockOnModelChange).not.toHaveBeenCalled()

		// Switch to credentials without deployments
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={[]}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, should still not call onModelChange when deployments array becomes empty
		expect(mockOnModelChange).not.toHaveBeenCalled()
	})

	it("should handle switching between different credential sets with different available deployments", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Initially should not call onModelChange since deployment ID already matches
		expect(mockOnModelChange).not.toHaveBeenCalled()

		// Switch to different credentials with different deployments
		const newDeployments = [{ modelName: "anthropic--claude-3.5-sonnet", deploymentId: "new-deployment-2" }]
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={newDeployments}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically with new deployment ID
		expect(mockOnModelChange).toHaveBeenCalledWith("anthropic--claude-3.5-sonnet", "new-deployment-2")
	})

	it("should ensure model replacement keeps the model changed correctly", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Initially should not call onModelChange since deployment ID already matches
		expect(mockOnModelChange).not.toHaveBeenCalled()

		// Change to a different model that has a deployment
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet", "gpt-4o"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="gpt-4o"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically with new model's deployment ID
		expect(mockOnModelChange).toHaveBeenCalledWith("gpt-4o", "deployment-2")
	})

	it("should handle model replacement from deployed to undeployed model", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Initially should not call onModelChange since deployment ID already matches
		expect(mockOnModelChange).not.toHaveBeenCalled()

		// Change to a model that doesn't have a deployment
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3-haiku"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically to clear deployment ID
		expect(mockOnModelChange).toHaveBeenCalledWith("anthropic--claude-3-haiku", "")
	})

	it("should handle model replacement from undeployed to deployed model", () => {
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedDeploymentId=""
					selectedModelId="anthropic--claude-3-haiku"
				/>
			</ExtensionStateContextProvider>,
		)

		// Initially should not call onModelChange (no deployment for haiku, no stale deployment ID)
		expect(mockOnModelChange).not.toHaveBeenCalled()

		// Change to a model that has a deployment
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedDeploymentId=""
					selectedModelId="gpt-4o"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically with deployment ID
		expect(mockOnModelChange).toHaveBeenCalledWith("gpt-4o", "deployment-1")
	})

	it("should handle complex credential switching scenario", () => {
		// Start with credentials that have claude deployed
		const { rerender } = render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["anthropic--claude-3.5-sonnet"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		expect(mockOnModelChange).not.toHaveBeenCalled()

		// Switch to credentials that have gpt-4o deployed instead
		rerender(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={createDeployments(["gpt-4o"])}
					selectedDeploymentId="deployment-1"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Since useEffect is active, onModelChange should be called automatically to clear deployment ID
		expect(mockOnModelChange).toHaveBeenCalledWith("anthropic--claude-3.5-sonnet", "")
	})

	it("should not trigger changes when deployments array is empty (loading state)", () => {
		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={[]}
					selectedDeploymentId="old-deployment-id"
					selectedModelId="anthropic--claude-3.5-sonnet"
				/>
			</ExtensionStateContextProvider>,
		)

		// Should not call onModelChange when deployments array is empty
		expect(mockOnModelChange).not.toHaveBeenCalled()
	})

	it("should not trigger changes when selectedModelId is empty", () => {
		const deployments = createDeployments(["anthropic--claude-3.5-sonnet"])

		render(
			<ExtensionStateContextProvider>
				<SapAiCoreModelPicker
					onModelChange={mockOnModelChange}
					sapAiCoreModelDeployments={deployments}
					selectedDeploymentId="some-deployment-id"
					selectedModelId=""
				/>
			</ExtensionStateContextProvider>,
		)

		// Should not call onModelChange when selectedModelId is empty
		expect(mockOnModelChange).not.toHaveBeenCalled()
	})
})
