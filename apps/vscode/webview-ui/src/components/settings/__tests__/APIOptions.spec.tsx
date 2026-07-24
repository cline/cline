import { ApiConfiguration } from "@shared/api"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderListings } from "@/hooks/useProviderListings"
import ApiOptions from "../ApiOptions"

vi.mock("@/hooks/useProviderListings", () => ({
	useProviderListings: vi.fn(() => ({ providers: [], isLoading: false, error: undefined, refresh: vi.fn() })),
}))

vi.mock("../providers/GenericProviderSettings", () => ({
	GenericProviderSettings: vi.fn((props) => <div data-testid="generic-provider-settings">{props.providerName}</div>),
}))

const mockProviderListings = (
	providers: Array<{ id: string; name: string; protocol: string; allowsCustomModelIds: boolean }>,
) => {
	vi.mocked(useProviderListings).mockReturnValue({ providers, isLoading: false, error: undefined, refresh: vi.fn() })
}

vi.mock("../../../context/ExtensionStateContext", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual || {}),
		// your mocked methods
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				planModeApiProvider: "requesty",
				actModeApiProvider: "requesty",
				requestyApiKey: "",
				planModeRequestyModelId: "",
				actModeRequestyModelId: "",
			},
			setApiConfiguration: vi.fn(),
			requestyModels: {},
			planActSeparateModelsSetting: false,
		})),
	}
})

const mockExtensionState = (apiConfiguration: Partial<ApiConfiguration>) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		setApiConfiguration: vi.fn(),
		requestyModels: {},
		planActSeparateModelsSetting: false,
		// Provider model-list context read by useProviderModels. Static-list
		// providers render their model <select> from this map, so seed the
		// providers exercised here with the model id each test expects.
		providerModelsByProvider: {
			fireworks: {
				models: { "accounts/fireworks/models/kimi-k2p5": { supportsPromptCache: false } },
				defaultModelId: "accounts/fireworks/models/kimi-k2p5",
			},
			nebius: {
				models: { "Qwen/Qwen2.5-32B-Instruct-fast": { supportsPromptCache: false } },
				defaultModelId: "Qwen/Qwen2.5-32B-Instruct-fast",
			},
		},
		startProviderModelsRequest: vi.fn(),
		applyProviderModelsResponse: vi.fn(),
	} as any)
}

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		vi.mocked(useProviderListings).mockReturnValue({ providers: [], isLoading: false, error: undefined, refresh: vi.fn() })
		mockExtensionState({
			planModeApiProvider: "requesty",
			actModeApiProvider: "requesty",
		})
	})

	it("renders Requesty API Key input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Requesty Model ID input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const modelIdInput = screen.getByPlaceholderText("Search and select a model...")
		expect(modelIdInput).toBeInTheDocument()
	})

	it.each([
		["openai-native", "OpenAI API Key"],
		["openai-codex", "Sign in to OpenAI Codex"],
	])("renders only the dedicated form for %s", (provider, dedicatedFormText) => {
		mockExtensionState({
			planModeApiProvider: provider as any,
			actModeApiProvider: provider as any,
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={false} />
			</ExtensionStateContextProvider>,
		)

		expect(screen.getByText(dedicatedFormText)).toBeInTheDocument()
		expect(screen.queryByText("Custom Headers")).not.toBeInTheDocument()
	})

	it("renders the OpenAI-compatible form for custom/unknown catalog providers", () => {
		vi.mocked(useProviderListings).mockReturnValue({
			providers: [
				{
					allowsCustomModelIds: true,
					id: "future-simple-provider",
					name: "Future Simple Provider",
					protocol: "openai-chat",
				},
			],
			isLoading: false,
			error: undefined,
			refresh: vi.fn(),
		})
		mockExtensionState({
			planModeApiProvider: "future-simple-provider" as any,
			actModeApiProvider: "future-simple-provider" as any,
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		// Custom/unknown providers use the richer OpenAI-compatible form (Base
		// URL, Custom Headers, Model Configuration, Reasoning Effort) rather than
		// the simpler generic settings form.
		expect(screen.getByText("Custom Headers")).toBeInTheDocument()
		expect(screen.queryByTestId("generic-provider-settings")).not.toBeInTheDocument()
	})
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionState({
			planModeApiProvider: "together",
			actModeApiProvider: "together",
		})
	})

	it("renders Together generic provider settings", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		expect(screen.getByTestId("generic-provider-settings")).toHaveTextContent("Together")
	})
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }

		mockProviderListings([{ id: "fireworks", name: "Fireworks", protocol: "openai-chat", allowsCustomModelIds: false }])
		mockExtensionState({
			planModeApiProvider: "fireworks",
			actModeApiProvider: "fireworks",
			fireworksApiKey: "",
			planModeFireworksModelId: "",
			actModeFireworksModelId: "",
			fireworksModelMaxCompletionTokens: 2000,
			fireworksModelMaxTokens: 4000,
		})
	})

	it("renders Fireworks generic provider settings", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		expect(screen.getByTestId("generic-provider-settings")).toHaveTextContent("Fireworks")
	})
})

describe("OpenApiInfoOptions", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionState({
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
		})
	})

	it("renders OpenAI Supports Images input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(screen.getByText("Model Configuration"))
		const apiKeyInput = screen.getByText("Supports Images")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders OpenAI Context Window Size input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(screen.getByText("Model Configuration"))
		const orgIdInput = screen.getByText("Context Window Size")
		expect(orgIdInput).toBeInTheDocument()
	})

	it("renders OpenAI Max Output Tokens input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(screen.getByText("Model Configuration"))
		const modelInput = screen.getByText("Max Output Tokens")
		expect(modelInput).toBeInTheDocument()
	})
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }

		mockProviderListings([{ id: "nebius", name: "Nebius", protocol: "openai-chat", allowsCustomModelIds: false }])
		mockExtensionState({
			planModeApiProvider: "nebius",
			actModeApiProvider: "nebius",
			nebiusApiKey: "",
		})
	})

	it("renders Nebius generic provider settings", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		expect(screen.getByTestId("generic-provider-settings")).toHaveTextContent("Nebius")
	})
})
