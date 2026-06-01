import { render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { OpenAICompatibleProvider } from "../providers/OpenAICompatible"

// Mock the gRPC client used to fetch the provider's model list
vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		refreshOpenAiModels: vi.fn(),
	},
}))

// Mock the config handlers (we only assert on rendering here)
vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleFieldChange: vi.fn(),
		handleModeFieldChange: vi.fn(),
	}),
}))

// Mock the extension state so we can drive apiConfiguration per test
vi.mock("../../../context/ExtensionStateContext", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	return {
		...actual,
		useExtensionState: vi.fn(),
	}
})

const mockState = (apiConfiguration: Record<string, any>) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		remoteConfigSettings: undefined,
		setApiConfiguration: vi.fn(),
	} as any)
}

const renderProvider = () => render(<OpenAICompatibleProvider currentMode="plan" showModelOptions={false} />)

describe("OpenAICompatibleProvider — model list", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		//@ts-expect-error - vscode is not defined in the test global namespace
		global.vscode = { postMessage: vi.fn() }
	})

	it("renders a model dropdown populated from the fetched /models list", async () => {
		vi.mocked(ModelsServiceClient.refreshOpenAiModels).mockResolvedValue({
			values: ["openai/gpt-4o", "amazon/amazon.nova-lite-v1:0"],
		} as any)
		mockState({
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			openAiBaseUrl: "https://api.edenai.run/v3",
			openAiApiKey: "test-key",
			planModeOpenAiModelId: "openai/gpt-4o",
			actModeOpenAiModelId: "openai/gpt-4o",
		})

		renderProvider()

		// The dropdown appears once the fetched models arrive
		const dropdown = await screen.findByRole("combobox")
		expect(within(dropdown).getAllByText("openai/gpt-4o").length).toBeGreaterThan(0)
		expect(within(dropdown).getAllByText("amazon/amazon.nova-lite-v1:0").length).toBeGreaterThan(0)
		// ...and the free-text fallback is gone
		expect(screen.queryByPlaceholderText("Enter Model ID...")).not.toBeInTheDocument()
	})

	it("falls back to the free-text Model ID field when no models are returned", async () => {
		vi.mocked(ModelsServiceClient.refreshOpenAiModels).mockResolvedValue({ values: [] } as any)
		mockState({
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			openAiBaseUrl: "https://example.com/v1",
			openAiApiKey: "test-key",
			planModeOpenAiModelId: "",
			actModeOpenAiModelId: "",
		})

		renderProvider()

		// Give the mount-time fetch a chance to resolve (to empty)
		await waitFor(() => expect(ModelsServiceClient.refreshOpenAiModels).toHaveBeenCalled())
		expect(screen.getAllByPlaceholderText("Enter Model ID...").length).toBeGreaterThan(0)
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
	})

	it("keeps a manually-entered model ID selectable even if it isn't in the fetched list", async () => {
		vi.mocked(ModelsServiceClient.refreshOpenAiModels).mockResolvedValue({
			values: ["openai/gpt-4o"],
		} as any)
		mockState({
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			openAiBaseUrl: "https://api.edenai.run/v3",
			openAiApiKey: "test-key",
			planModeOpenAiModelId: "some/custom-model",
			actModeOpenAiModelId: "some/custom-model",
		})

		renderProvider()

		const dropdown = await screen.findByRole("combobox")
		expect(within(dropdown).getAllByText("some/custom-model").length).toBeGreaterThan(0)
		expect(within(dropdown).getAllByText("openai/gpt-4o").length).toBeGreaterThan(0)
	})
})
