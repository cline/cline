import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import ApiOptions from "./ApiOptions"
import { ApiConfiguration } from "@shared/api"
import { StorybookProvider } from "../common/StorybookDecorator"

// Create a mock API configuration for stories
const mockApiConfiguration: ApiConfiguration = {
	apiProvider: undefined,
	apiKey: undefined,
	apiModelId: undefined,
}

// Enhanced mock state with API configuration
const ExtensionStateMockWithApi = {
	apiConfiguration: mockApiConfiguration,
}

const meta: Meta<typeof ApiOptions> = {
	title: "Component/ApiOptions",
	component: ApiOptions,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component: `
The ApiOptions component provides a comprehensive interface for configuring AI API providers and models in Cline.

**Features:**
- **Provider Selection**: Dropdown to choose from 20+ AI providers including Anthropic, OpenAI, OpenRouter, local models, and more
- **Dynamic Provider Forms**: Each provider has its own configuration form with provider-specific fields
- **Model Selection**: Provider-specific model dropdowns with real-time model fetching for local providers
- **Error Handling**: Displays API and model validation errors with clear messaging
- **Popup Mode**: Compact layout optimized for popup/modal contexts
- **Real-time Updates**: All settings save immediately without requiring a save button
- **Local Model Support**: Automatic discovery and polling for Ollama and LM Studio models
- **Secure Storage**: API keys are stored securely in VSCode's secrets storage

**Supported Providers:**
- **Cloud Providers**: Anthropic, OpenAI, OpenRouter, Google Gemini, AWS Bedrock, GCP Vertex AI
- **Specialized Providers**: DeepSeek, Mistral, Together, Fireworks, Cerebras, xAI, SambaNova
- **Local Providers**: Ollama, LM Studio, LiteLLM
- **Enterprise**: SAP AI Core, Nebius AI Studio, VSCode LM API
- **Regional**: Alibaba Qwen, Bytedance Doubao
- **Custom**: OpenAI Compatible, Requesty

**Use Cases:**
- Initial API provider setup and configuration
- Switching between different AI providers
- Configuring model-specific settings and parameters
- Managing API keys and authentication
- Setting up local model hosting solutions
        `,
			},
		},
	},
	decorators: [
		(Story) => {
			return (
				<StorybookProvider mockState={{ ...ExtensionStateMockWithApi }}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	argTypes: {
		showModelOptions: {
			control: "boolean",
			description: "Whether to show model selection options",
		},
		apiErrorMessage: {
			control: "text",
			description: "Error message to display for API configuration issues",
		},
		modelIdErrorMessage: {
			control: "text",
			description: "Error message to display for model selection issues",
		},
		isPopup: {
			control: "boolean",
			description: "Whether the component is displayed in a popup/modal context",
		},
	},
}

export default meta
type Story = StoryObj<typeof ApiOptions>

// Cline provider (default/free option)
export const ClineProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "cline",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Cline provider configuration (free tier option with built-in models).",
			},
		},
	},
}

// OpenRouter provider with model options
export const OpenRouterProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "openrouter",
					openRouterApiKey: "or-v1-abc123...",
					openRouterModelId: "anthropic/claude-3.5-sonnet",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "OpenRouter provider configuration with API key and model selection.",
			},
		},
	},
}

// OpenAI provider configuration
export const OpenAIProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "openai-native",
					openAiNativeApiKey: "sk-abc123...",
					openAiNativeModelId: "gpt-4o",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "OpenAI provider configuration with API key and GPT model selection.",
			},
		},
	},
}

// Local Ollama provider
export const OllamaProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "ollama",
					ollamaModelId: "llama3.2:latest",
					ollamaBaseUrl: "http://localhost:11434",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Ollama local provider configuration with base URL and model selection.",
			},
		},
	},
}

// AWS Bedrock provider
export const BedrockProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "bedrock",
					awsAccessKey: "AKIA...",
					awsSecretKey: "secret123...",
					awsRegion: "us-east-1",
					bedrockModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "AWS Bedrock provider configuration with credentials and model selection.",
			},
		},
	},
}

// Google Gemini provider
export const GeminiProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "gemini",
					geminiApiKey: "AIza...",
					geminiModelId: "gemini-1.5-pro-002",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Google Gemini provider configuration with API key and model selection.",
			},
		},
	},
}

// DeepSeek provider
export const DeepSeekProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "deepseek",
					deepSeekApiKey: "sk-abc123...",
					deepSeekModelId: "deepseek-chat",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "DeepSeek provider configuration with API key and model selection.",
			},
		},
	},
}

// VSCode LM provider
export const VSCodeLMProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "vscode-lm",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "VSCode Language Model API provider configuration (no additional setup required).",
			},
		},
	},
}

// With API error message
export const WithApiError: Story = {
	args: {
		showModelOptions: true,
		apiErrorMessage: "Invalid API key. Please check your credentials and try again.",
		isPopup: false,
	},
	parameters: {
		docs: {
			description: {
				story: "API options showing an API configuration error message.",
			},
		},
	},
}

// With model error message
export const WithModelError: Story = {
	args: {
		showModelOptions: true,
		modelIdErrorMessage: "Selected model is not available. Please choose a different model.",
		isPopup: false,
	},
	parameters: {
		docs: {
			description: {
				story: "API options showing a model selection error message.",
			},
		},
	},
}

// With both error messages
export const WithBothErrors: Story = {
	args: {
		showModelOptions: true,
		apiErrorMessage: "Connection failed: Unable to reach API endpoint.",
		modelIdErrorMessage: "Model validation failed: Insufficient permissions for selected model.",
		isPopup: false,
	},
	parameters: {
		docs: {
			description: {
				story: "API options showing both API and model error messages simultaneously.",
			},
		},
	},
}

// Without model options
export const WithoutModelOptions: Story = {
	args: {
		showModelOptions: false,
		isPopup: false,
	},
	parameters: {
		docs: {
			description: {
				story: "API options with model selection hidden, showing only provider selection.",
			},
		},
	},
}

// OpenAI Compatible provider with custom endpoint
export const OpenAICompatibleProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "openai",
					openAiApiKey: "custom-key-123",
					openAiBaseUrl: "https://api.custom-provider.com/v1",
					openAiModelId: "custom-model-v1",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "OpenAI Compatible provider with custom endpoint configuration for third-party APIs.",
			},
		},
	},
}

// LM Studio local provider
export const LMStudioProvider: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: {
					...ExtensionStateMockWithApi.apiConfiguration,
					apiProvider: "lmstudio",
					lmStudioBaseUrl: "http://localhost:1234/v1",
					lmStudioModelId: "local-model",
				} as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "LM Studio local provider configuration with base URL and model selection.",
			},
		},
	},
}

// Multiple providers comparison
export const ProviderComparison: Story = {
	args: {
		showModelOptions: true,
		isPopup: false,
	},
	decorators: [
		(Story) => {
			const [selectedProvider, setSelectedProvider] = React.useState("anthropic")

			const providers = [
				{ id: "anthropic", name: "Anthropic" },
				{ id: "openai-native", name: "OpenAI" },
				{ id: "openrouter", name: "OpenRouter" },
				{ id: "ollama", name: "Ollama" },
				{ id: "gemini", name: "Google Gemini" },
			]

			const getConfigForProvider = (provider: string) => {
				const baseConfig = ExtensionStateMockWithApi.apiConfiguration
				switch (provider) {
					case "openai-native":
						return { ...baseConfig, apiProvider: "openai-native", openAiNativeApiKey: "sk-test..." }
					case "openrouter":
						return { ...baseConfig, apiProvider: "openrouter", openRouterApiKey: "or-v1-test..." }
					case "ollama":
						return { ...baseConfig, apiProvider: "ollama", ollamaBaseUrl: "http://localhost:11434" }
					case "gemini":
						return { ...baseConfig, apiProvider: "gemini", geminiApiKey: "AIza..." }
					default:
						return { ...baseConfig, apiProvider: "anthropic" }
				}
			}

			const mockState = {
				...ExtensionStateMockWithApi,
				apiConfiguration: getConfigForProvider(selectedProvider) as ApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<div style={{ marginBottom: "20px" }}>
						<label style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}>Switch Provider:</label>
						<select
							value={selectedProvider}
							onChange={(e) => setSelectedProvider(e.target.value)}
							aria-label="Switch Provider"
							style={{
								padding: "4px 8px",
								borderRadius: "4px",
								border: "1px solid var(--vscode-widget-border)",
								backgroundColor: "var(--vscode-input-background)",
								color: "var(--vscode-input-foreground)",
							}}>
							{providers.map((provider) => (
								<option key={provider.id} value={provider.id}>
									{provider.name}
								</option>
							))}
						</select>
					</div>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Interactive comparison of different API providers with a provider switcher.",
			},
		},
	},
}
