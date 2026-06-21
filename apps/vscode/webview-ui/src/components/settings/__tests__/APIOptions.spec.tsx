import { ApiConfiguration } from "@shared/api"
import type { ProviderConfigField } from "@shared/proto/cline/models"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderListings } from "@/hooks/useProviderListings"
import ApiOptions from "../ApiOptions"
import { GenericProviderSettings } from "../providers/GenericProviderSettings"
import { OcaProvider } from "../providers/OcaProvider"

vi.mock("@/hooks/useProviderListings", () => ({
	useProviderListings: vi.fn(() => ({ providers: [], isLoading: false, error: undefined, refresh: vi.fn() })),
}))

vi.mock("../providers/GenericProviderSettings", () => ({
	GenericProviderSettings: vi.fn((props) => <div data-testid="generic-provider-settings">{props.providerName}</div>),
}))

vi.mock("../providers/ClineProvider", () => ({
	ClineProvider: vi.fn(() => <div data-testid="cline-provider" />),
}))

vi.mock("../providers/OcaProvider", () => ({
	OcaProvider: vi.fn(() => <div data-testid="oca-provider" />),
}))

const mockProviderListings = (
	providers: Array<{
		id: string
		name: string
		protocol: string
		allowsCustomModelIds: boolean
		capabilities?: string[]
		authMethod?: "api-key" | "oauth" | "local"
		configFields?: ProviderConfigField[]
		configValuesJson?: Record<string, string>
	}>,
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

const mockExtensionState = (apiConfiguration: Partial<ApiConfiguration>, options?: { remoteConfiguredProviders?: string[] }) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		setApiConfiguration: vi.fn(),
		remoteConfigSettings: options?.remoteConfiguredProviders
			? { remoteConfiguredProviders: options.remoteConfiguredProviders }
			: undefined,
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
		mockProviderListings([{ id: "requesty", name: "Requesty", protocol: "openai-chat", allowsCustomModelIds: false }])
		mockExtensionState({
			planModeApiProvider: "requesty",
			actModeApiProvider: "requesty",
		})
	})

	it("renders Requesty generic provider settings", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		expect(screen.getByTestId("generic-provider-settings")).toHaveTextContent("Requesty")
	})

	it("renders the generic provider fallback for simple SDK-listed providers without a custom override", () => {
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

		expect(screen.getByTestId("generic-provider-settings")).toHaveTextContent("Future Simple Provider")
	})

	it("falls unsupported persisted providers back to the VS Code default provider", () => {
		mockProviderListings([
			{
				id: "cline",
				name: "Cline",
				protocol: "openai-chat",
				allowsCustomModelIds: false,
			},
		])
		mockExtensionState({
			planModeApiProvider: "qwen-code" as any,
			actModeApiProvider: "qwen-code" as any,
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		expect(screen.getByTestId("cline-provider")).toBeInTheDocument()
		expect(screen.queryByText("qwen-code")).not.toBeInTheDocument()
	})

	it.each([
		{
			id: "bedrock",
			name: "AWS Bedrock",
			selectedProvider: "bedrock",
			field: {
				path: "aws.region",
				label: "AWS Region",
				type: "text",
				secret: false,
				required: false,
				options: [],
			} satisfies ProviderConfigField,
			values: { "aws.region": JSON.stringify("us-east-1") },
		},
		{
			id: "vertex",
			name: "Google Vertex AI",
			selectedProvider: "vertex",
			field: {
				path: "gcp.projectId",
				label: "Project ID",
				type: "text",
				secret: false,
				required: false,
				options: [],
			} satisfies ProviderConfigField,
			values: { "gcp.projectId": JSON.stringify("project-a") },
		},
		{
			id: "sapaicore",
			name: "SAP AI Core",
			selectedProvider: "sapaicore",
			field: {
				path: "sap.resourceGroup",
				label: "Resource Group",
				type: "text",
				secret: false,
				required: false,
				options: [],
			} satisfies ProviderConfigField,
			values: { "sap.resourceGroup": JSON.stringify("default") },
		},
		{
			id: "openai-compatible",
			name: "OpenAI Compatible",
			selectedProvider: "openai",
			field: {
				path: "baseUrl",
				label: "Base URL",
				type: "url",
				secret: false,
				required: false,
				options: [],
			} satisfies ProviderConfigField,
			values: { baseUrl: JSON.stringify("https://api.example.com/v1") },
		},
		{
			id: "future-sdk-only",
			name: "Future SDK Only",
			selectedProvider: "future-sdk-only",
			field: {
				path: "apiKey",
				label: "API Key",
				type: "password",
				secret: true,
				required: true,
				options: [],
			} satisfies ProviderConfigField,
			values: {},
		},
	])("passes SDK config fields through for $name", ({ id, name, selectedProvider, field, values }) => {
		vi.mocked(GenericProviderSettings).mockClear()
		mockProviderListings([
			{
				id,
				name,
				protocol: "openai-chat",
				allowsCustomModelIds: id === "openai-compatible",
				configFields: [field],
				configValuesJson: values,
			},
		])
		mockExtensionState({
			planModeApiProvider: selectedProvider as any,
			actModeApiProvider: selectedProvider as any,
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		const [props] = vi.mocked(GenericProviderSettings).mock.calls[0]
		expect(props).toMatchObject({
			providerId: id,
			providerName: name,
			configFields: [field],
			configValuesJson: values,
		})
	})

	it.each([
		{
			id: "bedrock",
			name: "AWS Bedrock",
			selectedProvider: "bedrock",
			path: "aws.customModelBaseId",
			values: { "aws.customModelBaseId": JSON.stringify("provider-wide-base") },
			apiConfiguration: {
				planModeApiProvider: "bedrock",
				actModeApiProvider: "bedrock",
				planModeAwsBedrockCustomModelBaseId: "plan-base",
				actModeAwsBedrockCustomModelBaseId: "act-base",
			},
			expected: "act-base",
		},
		{
			id: "sapaicore",
			name: "SAP AI Core",
			selectedProvider: "sapaicore",
			path: "sap.deploymentId",
			values: { "sap.deploymentId": JSON.stringify("provider-wide-deployment") },
			apiConfiguration: {
				planModeApiProvider: "sapaicore",
				actModeApiProvider: "sapaicore",
				planModeSapAiCoreDeploymentId: "plan-deployment",
				actModeSapAiCoreDeploymentId: "act-deployment",
			},
			expected: "act-deployment",
		},
	])("passes active-mode SDK config values through for $name", ({ id, name, path, values, apiConfiguration, expected }) => {
		vi.mocked(GenericProviderSettings).mockClear()
		mockProviderListings([
			{
				id,
				name,
				protocol: "openai-chat",
				allowsCustomModelIds: id === "bedrock",
				configFields: [
					{
						path,
						label: "Mode-scoped field",
						type: "text",
						secret: false,
						required: false,
						options: [],
					},
				],
				configValuesJson: values,
			},
		])
		mockExtensionState(apiConfiguration as Partial<ApiConfiguration>)

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="act" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		const [props] = vi.mocked(GenericProviderSettings).mock.calls[0]
		expect(props.configValuesJson?.[path]).toBe(JSON.stringify(expected))
	})

	it("allows remote configuration to refer to the SDK provider id for aliased providers", () => {
		mockProviderListings([
			{
				id: "openai-compatible",
				name: "OpenAI Compatible",
				protocol: "openai-chat",
				allowsCustomModelIds: true,
			},
		])
		mockExtensionState(
			{
				planModeApiProvider: "openai",
				actModeApiProvider: "openai",
			},
			{ remoteConfiguredProviders: ["openai-compatible"] },
		)

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		fireEvent.focus(screen.getByTestId("provider-selector-input"))
		expect(screen.getByTestId("provider-option-openai")).toHaveTextContent("OpenAI Compatible")
	})

	it("labels OAuth providers from SDK/core auth method rather than raw capabilities", () => {
		mockProviderListings([
			{
				id: "openai-codex",
				name: "OpenAI ChatGPT Subscription",
				protocol: "responses",
				allowsCustomModelIds: false,
				authMethod: "oauth",
			},
			{
				id: "opencode",
				name: "OpenCode",
				protocol: "responses",
				allowsCustomModelIds: false,
				capabilities: ["oauth"],
				authMethod: "api-key",
			},
		])
		mockExtensionState({
			planModeApiProvider: "openai-codex",
			actModeApiProvider: "openai-codex",
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		fireEvent.focus(screen.getByTestId("provider-selector-input"))
		expect(screen.getByTestId("provider-option-openai-codex")).toHaveTextContent("OpenAI ChatGPT Subscription (OAuth)")
		expect(screen.getByTestId("provider-option-opencode")).toHaveTextContent("OpenCode")
		expect(screen.getByTestId("provider-option-opencode")).not.toHaveTextContent("(OAuth)")
	})

	it("does not pass the generic SDK apiKey field to the OCA OAuth settings UI", () => {
		vi.mocked(OcaProvider).mockClear()
		const apiKeyField = {
			path: "apiKey",
			label: "API Key",
			type: "password",
			secret: true,
			required: true,
			options: [],
		} satisfies ProviderConfigField
		const promptCacheField = {
			path: "oca.usePromptCache",
			label: "Prompt Cache",
			type: "boolean",
			secret: false,
			required: false,
			options: [],
		} satisfies ProviderConfigField
		mockProviderListings([
			{
				id: "oca",
				name: "Oracle Code Assist",
				protocol: "openai-chat",
				allowsCustomModelIds: false,
				configFields: [
					{
						path: "oca.mode",
						label: "OCA Mode",
						type: "select",
						secret: false,
						required: false,
						options: [],
					},
					apiKeyField,
					promptCacheField,
				],
			},
		])
		mockExtensionState({
			planModeApiProvider: "oca",
			actModeApiProvider: "oca",
		})

		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)

		const [props] = vi.mocked(OcaProvider).mock.calls[0]
		expect(props.configFields).toEqual([promptCacheField])
	})
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockProviderListings([{ id: "together", name: "Together", protocol: "openai-chat", allowsCustomModelIds: false }])
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

describe("OpenAI provider settings", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockProviderListings([
			{ id: "openai-compatible", name: "OpenAI Compatible", protocol: "openai-chat", allowsCustomModelIds: true },
		])
		mockExtensionState({
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
		})
	})

	it("renders OpenAI-compatible generic provider settings", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions currentMode="plan" showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		expect(screen.getByTestId("generic-provider-settings")).toHaveTextContent("OpenAI Compatible")
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
