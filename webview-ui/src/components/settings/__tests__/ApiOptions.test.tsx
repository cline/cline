import React from "react"
import { render, screen } from "@testing-library/react"
import ApiOptions from "../ApiOptions"
import { ApiConfiguration } from "@shared/api"
import { vi, describe, test, expect, beforeEach } from "vitest"

// Create a variable for the mock config that we can change between tests
let mockApiConfig: ApiConfiguration | undefined = {
	apiProvider: "anthropic",
	apiKey: "test-key",
	// Add other needed fields
}

// Mock the useExtensionState hook instead of trying to use the context directly
vi.mock("../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: mockApiConfig,
		setApiConfiguration: vi.fn(),
		uriScheme: "vscode",
	}),
}))

// Mock the vscode API
vi.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock subcomponents to simplify the test
vi.mock("../providers/AnthropicProvider", () => ({
	AnthropicProvider: () => <div data-testid="anthropic-provider">Anthropic Provider</div>,
}))

vi.mock("../providers/OpenRouterProvider", () => ({
	OpenRouterProvider: () => <div data-testid="openrouter-provider">OpenRouter Provider</div>,
}))

vi.mock("../providers/GeminiProvider", () => ({
	GeminiProvider: () => <div data-testid="gemini-provider">Gemini Provider</div>,
}))

vi.mock("../providers/RequestyProvider", () => ({
	RequestyProvider: () => <div data-testid="requesty-provider">Requesty Provider</div>,
}))

vi.mock("../providers/TogetherProvider", () => ({
	TogetherProvider: () => <div data-testid="together-provider">Together Provider</div>,
}))

vi.mock("../providers/QwenProvider", () => ({
	QwenProvider: () => <div data-testid="qwen-provider">Qwen Provider</div>,
}))

vi.mock("../providers/DoubaoProvider", () => ({
	DoubaoProvider: () => <div data-testid="doubao-provider">Doubao Provider</div>,
}))

vi.mock("../providers/LMStudioProvider", () => ({
	LMStudioProvider: () => <div data-testid="lmstudio-provider">LM Studio Provider</div>,
}))

vi.mock("../providers/LiteLLMProvider", () => ({
	LiteLLMProvider: () => <div data-testid="litellm-provider">LiteLLM Provider</div>,
}))

vi.mock("../providers/AskSageProvider", () => ({
	AskSageProvider: () => <div data-testid="asksage-provider">AskSage Provider</div>,
}))

vi.mock("../providers/XAIProvider", () => ({
	XAIProvider: () => <div data-testid="xai-provider">XAI Provider</div>,
}))

vi.mock("../providers/SambanovaProvider", () => ({
	SambanovaProvider: () => <div data-testid="sambanova-provider">SambaNova Provider</div>,
}))

vi.mock("../providers/MistralProvider", () => ({
	MistralProvider: () => <div data-testid="mistral-provider">Mistral Provider</div>,
}))

vi.mock("../providers/DeepSeekProvider", () => ({
	DeepSeekProvider: () => <div data-testid="deepseek-provider">DeepSeek Provider</div>,
}))

vi.mock("../providers/BedrockProvider", () => ({
	BedrockProvider: () => <div data-testid="bedrock-provider">Bedrock Provider</div>,
}))

vi.mock("../providers/OpenAICompatibleProvider", () => ({
	OpenAICompatibleProvider: () => <div data-testid="openai-provider">OpenAI Compatible Provider</div>,
}))

vi.mock("../providers/OllamaProvider", () => ({
	OllamaProvider: () => <div data-testid="ollama-provider">Ollama Provider</div>,
}))

vi.mock("../providers/VSCodeLMProvider", () => ({
	VSCodeLMProvider: () => <div data-testid="vscode-lm-provider">VS Code LM Provider</div>,
}))

vi.mock("../providers/VertexProvider", () => ({
	VertexProvider: () => <div data-testid="vertex-provider">Vertex Provider</div>,
}))

vi.mock("../providers/ClineProvider", () => ({
	ClineProvider: () => <div data-testid="cline-provider">Cline Provider</div>,
}))

vi.mock("../providers/OpenAINativeProvider", () => ({
	OpenAINativeProvider: () => <div data-testid="openai-native-provider">OpenAI Native Provider</div>,
}))

// Mock the common components
vi.mock("../common/ModelSelector", () => ({
	DropdownContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown-container">{children}</div>,
}))

vi.mock("../common/ErrorMessage", () => ({
	ErrorMessage: ({ message }: { message: string }) => <div data-testid="error-message">{message}</div>,
}))

describe("ApiOptions Component", () => {
	beforeEach(() => {
		// Reset the mock config before each test
		mockApiConfig = {
			apiProvider: "anthropic",
			apiKey: "test-key",
		}
	})

	test("renders provider dropdown", () => {
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByText("API Provider")).toBeInTheDocument()
	})

	test("renders Anthropic provider when selected", () => {
		mockApiConfig = {
			apiProvider: "anthropic",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("anthropic-provider")).toBeInTheDocument()
	})

	test("renders OpenRouter provider when selected", () => {
		mockApiConfig = {
			apiProvider: "openrouter",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("openrouter-provider")).toBeInTheDocument()
	})

	test("renders Bedrock provider when selected", () => {
		mockApiConfig = {
			apiProvider: "bedrock",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("bedrock-provider")).toBeInTheDocument()
	})

	test("renders OpenAI Compatible provider when selected", () => {
		mockApiConfig = {
			apiProvider: "openai",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("openai-provider")).toBeInTheDocument()
	})

	test("renders Ollama provider when selected", () => {
		mockApiConfig = {
			apiProvider: "ollama",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("ollama-provider")).toBeInTheDocument()
	})

	test("renders VS Code LM provider when selected", () => {
		mockApiConfig = {
			apiProvider: "vscode-lm",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("vscode-lm-provider")).toBeInTheDocument()
	})

	test("renders Vertex provider when selected", () => {
		mockApiConfig = {
			apiProvider: "vertex",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("vertex-provider")).toBeInTheDocument()
	})

	test("renders Cline provider when selected", () => {
		mockApiConfig = {
			apiProvider: "cline",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("cline-provider")).toBeInTheDocument()
	})

	test("renders Gemini provider when selected", () => {
		mockApiConfig = {
			apiProvider: "gemini",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("gemini-provider")).toBeInTheDocument()
	})

	test("renders Mistral provider when selected", () => {
		mockApiConfig = {
			apiProvider: "mistral",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("mistral-provider")).toBeInTheDocument()
	})

	test("renders DeepSeek provider when selected", () => {
		mockApiConfig = {
			apiProvider: "deepseek",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("deepseek-provider")).toBeInTheDocument()
	})

	test("renders OpenAI Native provider when selected", () => {
		mockApiConfig = {
			apiProvider: "openai-native",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("openai-native-provider")).toBeInTheDocument()
	})

	test("renders Requesty provider when selected", () => {
		mockApiConfig = {
			apiProvider: "requesty",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("requesty-provider")).toBeInTheDocument()
	})

	test("renders Together provider when selected", () => {
		mockApiConfig = {
			apiProvider: "together",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("together-provider")).toBeInTheDocument()
	})

	test("renders Qwen provider when selected", () => {
		mockApiConfig = {
			apiProvider: "qwen",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("qwen-provider")).toBeInTheDocument()
	})

	test("renders Doubao provider when selected", () => {
		mockApiConfig = {
			apiProvider: "doubao",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("doubao-provider")).toBeInTheDocument()
	})

	test("renders LM Studio provider when selected", () => {
		mockApiConfig = {
			apiProvider: "lmstudio",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("lmstudio-provider")).toBeInTheDocument()
	})

	test("renders LiteLLM provider when selected", () => {
		mockApiConfig = {
			apiProvider: "litellm",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("litellm-provider")).toBeInTheDocument()
	})

	test("renders AskSage provider when selected", () => {
		mockApiConfig = {
			apiProvider: "asksage",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("asksage-provider")).toBeInTheDocument()
	})

	test("renders XAI provider when selected", () => {
		mockApiConfig = {
			apiProvider: "xai",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("xai-provider")).toBeInTheDocument()
	})

	test("renders SambaNova provider when selected", () => {
		mockApiConfig = {
			apiProvider: "sambanova",
			apiKey: "test-key",
		}
		render(<ApiOptions showModelOptions={true} />)
		expect(screen.getByTestId("sambanova-provider")).toBeInTheDocument()
	})

	test("displays error message when provided", () => {
		render(<ApiOptions showModelOptions={true} apiErrorMessage="Test error" />)
		expect(screen.getByTestId("error-message")).toHaveTextContent("Test error")
	})
})
