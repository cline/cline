import { describe, it, expect } from "vitest"
import { getFormatForProvider, isVertexAnthropicModel } from "../api"
import { ProviderName } from "@roo-code/types"

describe("providerFormat", () => {
	describe("getFormatForProvider", () => {
		it("should return 'anthropic' for Anthropic-based providers", () => {
			const anthropicProviders: ProviderName[] = ["anthropic", "bedrock", "vertex", "claude-code", "requesty"]

			anthropicProviders.forEach((provider) => {
				expect(getFormatForProvider(provider)).toBe("anthropic")
			})
		})

		it("should return 'openai' for OpenAI-based providers", () => {
			const openaiProviders: ProviderName[] = [
				"openai",
				"openai-native",
				"deepseek",
				"moonshot",
				"xai",
				"groq",
				"chutes",
				"mistral",
				"ollama",
				"lmstudio",
				"litellm",
				"huggingface",
				"glama",
				"unbound",
				"vscode-lm",
				"human-relay",
				"fake-ai",
			]

			openaiProviders.forEach((provider) => {
				expect(getFormatForProvider(provider)).toBe("openai")
			})
		})

		it("should return 'gemini' for Gemini-based providers", () => {
			const geminiProviders: ProviderName[] = ["gemini", "gemini-cli"]

			geminiProviders.forEach((provider) => {
				expect(getFormatForProvider(provider)).toBe("gemini")
			})
		})

		it("should return 'openrouter' for OpenRouter provider", () => {
			expect(getFormatForProvider("openrouter")).toBe("openrouter")
		})

		it("should return undefined for undefined provider", () => {
			expect(getFormatForProvider(undefined)).toBeUndefined()
		})

		it("should return undefined for unknown providers", () => {
			// Test with a provider that doesn't exist in the switch statement
			// by casting to bypass TypeScript type checking
			expect(getFormatForProvider("unknown-provider" as ProviderName)).toBeUndefined()
		})
	})

	describe("isVertexAnthropicModel", () => {
		it("should return true for Claude models", () => {
			expect(isVertexAnthropicModel("claude-3-opus")).toBe(true)
			expect(isVertexAnthropicModel("claude-3-sonnet")).toBe(true)
			expect(isVertexAnthropicModel("claude-3-haiku")).toBe(true)
			expect(isVertexAnthropicModel("CLAUDE-3-OPUS")).toBe(true) // Case insensitive
			expect(isVertexAnthropicModel("anthropic.claude-v2")).toBe(true)
		})

		it("should return false for non-Claude models", () => {
			expect(isVertexAnthropicModel("gemini-pro")).toBe(false)
			expect(isVertexAnthropicModel("gemini-1.5-pro")).toBe(false)
			expect(isVertexAnthropicModel("palm-2")).toBe(false)
			expect(isVertexAnthropicModel("gpt-4")).toBe(false)
		})

		it("should return false for undefined or empty model ID", () => {
			expect(isVertexAnthropicModel(undefined)).toBe(false)
			expect(isVertexAnthropicModel("")).toBe(false)
		})
	})
})
