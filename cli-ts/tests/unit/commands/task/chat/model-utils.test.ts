/**
 * Tests for model-utils functions
 */

import { expect } from "chai"
import { getModelIdForProvider, getModelIdKey } from "../../../../../src/commands/task/chat/model-utils.js"

describe("model-utils", () => {
	describe("getModelIdForProvider", () => {
		it("should return undefined for undefined configuration", () => {
			const result = getModelIdForProvider(undefined, "openrouter", "act")
			expect(result).to.be.undefined
		})

		it("should return undefined for undefined provider", () => {
			const apiConfig = {
				actModeApiModelId: "test-model",
			}
			const result = getModelIdForProvider(apiConfig as any, undefined, "act")
			expect(result).to.be.undefined
		})

		it("should return OpenRouter model ID for openrouter provider in act mode", () => {
			const apiConfig = {
				actModeOpenRouterModelId: "anthropic/claude-3",
			}
			const result = getModelIdForProvider(apiConfig as any, "openrouter", "act")
			expect(result).to.equal("anthropic/claude-3")
		})

		it("should return OpenRouter model ID for openrouter provider in plan mode", () => {
			const apiConfig = {
				planModeOpenRouterModelId: "anthropic/claude-3-opus",
			}
			const result = getModelIdForProvider(apiConfig as any, "openrouter", "plan")
			expect(result).to.equal("anthropic/claude-3-opus")
		})

		it("should return OpenRouter model ID for cline provider", () => {
			const apiConfig = {
				actModeOpenRouterModelId: "anthropic/claude-3",
			}
			const result = getModelIdForProvider(apiConfig as any, "cline", "act")
			expect(result).to.equal("anthropic/claude-3")
		})

		it("should return API model ID for anthropic provider", () => {
			const apiConfig = {
				actModeApiModelId: "claude-3-sonnet",
			}
			const result = getModelIdForProvider(apiConfig as any, "anthropic", "act")
			expect(result).to.equal("claude-3-sonnet")
		})

		it("should return OpenAI model ID for openai provider", () => {
			const apiConfig = {
				actModeOpenAiModelId: "gpt-4",
			}
			const result = getModelIdForProvider(apiConfig as any, "openai", "act")
			expect(result).to.equal("gpt-4")
		})

		it("should return Ollama model ID for ollama provider", () => {
			const apiConfig = {
				actModeOllamaModelId: "llama2",
			}
			const result = getModelIdForProvider(apiConfig as any, "ollama", "act")
			expect(result).to.equal("llama2")
		})

		it("should return LiteLLM model ID for litellm provider", () => {
			const apiConfig = {
				planModeLiteLlmModelId: "gpt-4-turbo",
			}
			const result = getModelIdForProvider(apiConfig as any, "litellm", "plan")
			expect(result).to.equal("gpt-4-turbo")
		})

		it("should return undefined for vscode-lm provider", () => {
			const apiConfig = {
				actModeApiModelId: "test-model",
			}
			const result = getModelIdForProvider(apiConfig as any, "vscode-lm", "act")
			expect(result).to.be.undefined
		})

		it("should return undefined for dify provider", () => {
			const apiConfig = {
				actModeApiModelId: "test-model",
			}
			const result = getModelIdForProvider(apiConfig as any, "dify", "act")
			expect(result).to.be.undefined
		})
	})

	describe("getModelIdKey", () => {
		it("should return OpenRouter key for openrouter provider in act mode", () => {
			const result = getModelIdKey("openrouter", "act")
			expect(result).to.equal("actModeOpenRouterModelId")
		})

		it("should return OpenRouter key for openrouter provider in plan mode", () => {
			const result = getModelIdKey("openrouter", "plan")
			expect(result).to.equal("planModeOpenRouterModelId")
		})

		it("should return OpenRouter key for cline provider", () => {
			const result = getModelIdKey("cline", "act")
			expect(result).to.equal("actModeOpenRouterModelId")
		})

		it("should return OpenAI key for openai provider", () => {
			const result = getModelIdKey("openai", "act")
			expect(result).to.equal("actModeOpenAiModelId")
		})

		it("should return Ollama key for ollama provider", () => {
			const result = getModelIdKey("ollama", "plan")
			expect(result).to.equal("planModeOllamaModelId")
		})

		it("should return LmStudio key for lmstudio provider", () => {
			const result = getModelIdKey("lmstudio", "act")
			expect(result).to.equal("actModeLmStudioModelId")
		})

		it("should return LiteLLM key for litellm provider", () => {
			const result = getModelIdKey("litellm", "act")
			expect(result).to.equal("actModeLiteLlmModelId")
		})

		it("should return Groq key for groq provider", () => {
			const result = getModelIdKey("groq", "plan")
			expect(result).to.equal("planModeGroqModelId")
		})

		it("should return default ApiModelId key for unknown provider", () => {
			const result = getModelIdKey("unknown-provider", "act")
			expect(result).to.equal("actModeApiModelId")
		})

		it("should return default ApiModelId key for undefined provider", () => {
			const result = getModelIdKey(undefined, "act")
			expect(result).to.equal("actModeApiModelId")
		})
	})
})
