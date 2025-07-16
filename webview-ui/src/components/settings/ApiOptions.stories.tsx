import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import ApiOptions from "./ApiOptions"
import { ApiConfiguration } from "@shared/api"
import { StorybookProvider, VSCodeWebview } from "../common/StorybookDecorator"
import { ExtensionState } from "@shared/ExtensionMessage"

const mockApiConfiguration: ApiConfiguration = {
	apiModelId: undefined,
	apiKey: undefined,
	apiProvider: "cline",
	favoritedModelIds: [],
}

const createMockState = (config: Partial<ApiConfiguration>): Partial<ExtensionState> => ({
	apiConfiguration: { ...mockApiConfiguration, ...config } as ApiConfiguration,
})

const createStoryDecorator = (config: Partial<ApiConfiguration>) => (Story: React.ComponentType) => (
	<StorybookProvider mockState={createMockState(config)}>
		<Story />
	</StorybookProvider>
)

const meta: Meta<typeof ApiOptions> = {
	title: "Component/ApiOptions",
	component: ApiOptions,
	decorators: [VSCodeWebview],
	argTypes: {
		showModelOptions: { control: "boolean" },
		apiErrorMessage: { control: "text" },
		modelIdErrorMessage: { control: "text" },
		isPopup: { control: "boolean" },
	},
}

export default meta
type Story = StoryObj<typeof ApiOptions>

const defaultArgs = {
	showModelOptions: true,
	isPopup: false,
}

export const ClineProvider: Story = {
	args: defaultArgs,
	decorators: [createStoryDecorator({ apiProvider: "cline" })],
}

export const OpenRouterProvider: Story = {
	args: defaultArgs,
	decorators: [createStoryDecorator({ apiProvider: "openrouter" })],
}

export const OpenAIProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "openai-native",
			openAiNativeApiKey: "sk-abc123...",
			openAiModelId: "gpt-4o",
		}),
	],
}

export const OllamaProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "ollama",
			ollamaModelId: "llama3.2:latest",
			ollamaBaseUrl: "http://localhost:11434",
		}),
	],
}

export const BedrockProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "bedrock",
			awsAccessKey: "AKIA...",
			awsSecretKey: "secret123...",
			awsRegion: "us-east-1",
			awsBedrockCustomModelBaseId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
		}),
	],
}

export const GeminiProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "gemini",
			geminiApiKey: "AIza...",
			apiModelId: "gemini-1.5-pro-002",
		}),
	],
}

export const DeepSeekProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "deepseek",
			deepSeekApiKey: "sk-abc123...",
			apiModelId: "deepseek-chat",
		}),
	],
}

export const VSCodeLMProvider: Story = {
	args: defaultArgs,
	decorators: [createStoryDecorator({ apiProvider: "vscode-lm" })],
}

export const OpenAICompatibleProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "openai",
			openAiApiKey: "custom-key-123",
			openAiBaseUrl: "https://api.custom-provider.com/v1",
			openAiModelId: "custom-model-v1",
		}),
	],
}

export const LMStudioProvider: Story = {
	args: defaultArgs,
	decorators: [
		createStoryDecorator({
			apiProvider: "lmstudio",
			lmStudioBaseUrl: "http://localhost:1234/v1",
			lmStudioModelId: "local-model",
		}),
	],
}

interface ApiOptionsProps {
	showSubmitButton?: boolean
	showModelOptions: boolean
	apiErrorMessage?: string
	modelIdErrorMessage?: string
	isPopup?: boolean
}

const ErrorStatesComponent: React.FC<ApiOptionsProps> = (args) => {
	const [errorType, setErrorType] = React.useState<"api" | "model" | "both" | "none">("api")

	const errorProps = {
		api: { apiErrorMessage: "Invalid API key. Please check your credentials and try again." },
		model: { modelIdErrorMessage: "Selected model is not available. Please choose a different model." },
		both: {
			apiErrorMessage: "Connection failed: Unable to reach API endpoint.",
			modelIdErrorMessage: "Model validation failed: Insufficient permissions for selected model.",
		},
		none: {},
	}

	return (
		<StorybookProvider mockState={createMockState({})}>
			<div className="mb-5">
				<label className="block mb-2 font-medium">Error Type:</label>
				<select
					title="Error Type"
					value={errorType}
					onChange={(e) => setErrorType(e.target.value as typeof errorType)}
					className="px-2 py-1 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]">
					<option value="api">API Error</option>
					<option value="model">Model Error</option>
					<option value="both">Both Errors</option>
					<option value="none">No Errors</option>
				</select>
			</div>
			<ApiOptions {...args} {...errorProps[errorType]} />
		</StorybookProvider>
	)
}

export const ErrorStates: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	render: (args) => <ErrorStatesComponent {...args} />,
	parameters: {
		docs: {
			description: {
				story: "Interactive error states showing API, model, or both error messages.",
			},
		},
	},
}

const ProviderComparisonComponent: React.FC<ApiOptionsProps> = (args) => {
	const [selectedProvider, setSelectedProvider] = React.useState("anthropic")

	const providerConfigs = {
		anthropic: { apiProvider: "anthropic" },
		"openai-native": { apiProvider: "openai-native", openAiNativeApiKey: "sk-test..." },
		openrouter: { apiProvider: "openrouter", openRouterApiKey: "or-v1-test..." },
		ollama: { apiProvider: "ollama", ollamaBaseUrl: "http://localhost:11434" },
		gemini: { apiProvider: "gemini", geminiApiKey: "AIza..." },
	} as const

	const providers = Object.keys(providerConfigs).map((id) => ({
		id,
		name: id.charAt(0).toUpperCase() + id.slice(1).replace("-", " "),
	}))

	const mockState = React.useMemo(
		() => createMockState(providerConfigs[selectedProvider as keyof typeof providerConfigs]),
		[selectedProvider],
	)

	return (
		<StorybookProvider mockState={mockState}>
			<div className="mb-5">
				<label className="block mb-2 font-medium">Switch Provider:</label>
				<select
					title="API Provider"
					value={selectedProvider}
					onChange={(e) => setSelectedProvider(e.target.value)}
					className="px-2 py-1 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)]">
					{providers.map((provider) => (
						<option key={provider.id} value={provider.id}>
							{provider.name}
						</option>
					))}
				</select>
			</div>
			<ApiOptions {...args} />
		</StorybookProvider>
	)
}

export const ProviderComparison: Story = {
	args: defaultArgs,
	render: (args) => <ProviderComparisonComponent {...args} />,
	parameters: {
		docs: {
			description: {
				story: "Interactive comparison of different API providers with a provider switcher.",
			},
		},
	},
}
