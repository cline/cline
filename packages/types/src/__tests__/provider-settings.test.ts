import { describe, it, expect } from "vitest"
import { getApiProtocol } from "../provider-settings.js"

describe("getApiProtocol", () => {
	describe("Anthropic-style providers", () => {
		it("should return 'anthropic' for anthropic provider", () => {
			expect(getApiProtocol("anthropic")).toBe("anthropic")
			expect(getApiProtocol("anthropic", "gpt-4")).toBe("anthropic")
		})

		it("should return 'anthropic' for claude-code provider", () => {
			expect(getApiProtocol("claude-code")).toBe("anthropic")
			expect(getApiProtocol("claude-code", "some-model")).toBe("anthropic")
		})
	})

	describe("Vertex provider with Claude models", () => {
		it("should return 'anthropic' for vertex provider with claude models", () => {
			expect(getApiProtocol("vertex", "claude-3-opus")).toBe("anthropic")
			expect(getApiProtocol("vertex", "Claude-3-Sonnet")).toBe("anthropic")
			expect(getApiProtocol("vertex", "CLAUDE-instant")).toBe("anthropic")
			expect(getApiProtocol("vertex", "anthropic/claude-3-haiku")).toBe("anthropic")
		})

		it("should return 'openai' for vertex provider with non-claude models", () => {
			expect(getApiProtocol("vertex", "gpt-4")).toBe("openai")
			expect(getApiProtocol("vertex", "gemini-pro")).toBe("openai")
			expect(getApiProtocol("vertex", "llama-2")).toBe("openai")
		})
	})

	describe("Bedrock provider with Claude models", () => {
		it("should return 'anthropic' for bedrock provider with claude models", () => {
			expect(getApiProtocol("bedrock", "claude-3-opus")).toBe("anthropic")
			expect(getApiProtocol("bedrock", "Claude-3-Sonnet")).toBe("anthropic")
			expect(getApiProtocol("bedrock", "CLAUDE-instant")).toBe("anthropic")
			expect(getApiProtocol("bedrock", "anthropic.claude-v2")).toBe("anthropic")
		})

		it("should return 'openai' for bedrock provider with non-claude models", () => {
			expect(getApiProtocol("bedrock", "gpt-4")).toBe("openai")
			expect(getApiProtocol("bedrock", "titan-text")).toBe("openai")
			expect(getApiProtocol("bedrock", "llama-2")).toBe("openai")
		})
	})

	describe("Other providers with Claude models", () => {
		it("should return 'openai' for non-vertex/bedrock providers with claude models", () => {
			expect(getApiProtocol("openrouter", "claude-3-opus")).toBe("openai")
			expect(getApiProtocol("openai", "claude-3-sonnet")).toBe("openai")
			expect(getApiProtocol("litellm", "claude-instant")).toBe("openai")
			expect(getApiProtocol("ollama", "claude-model")).toBe("openai")
		})
	})

	describe("Edge cases", () => {
		it("should return 'openai' when provider is undefined", () => {
			expect(getApiProtocol(undefined)).toBe("openai")
			expect(getApiProtocol(undefined, "claude-3-opus")).toBe("openai")
		})

		it("should return 'openai' when model is undefined", () => {
			expect(getApiProtocol("openai")).toBe("openai")
			expect(getApiProtocol("vertex")).toBe("openai")
			expect(getApiProtocol("bedrock")).toBe("openai")
		})

		it("should handle empty strings", () => {
			expect(getApiProtocol("vertex", "")).toBe("openai")
			expect(getApiProtocol("bedrock", "")).toBe("openai")
		})

		it("should be case-insensitive for claude detection", () => {
			expect(getApiProtocol("vertex", "CLAUDE-3-OPUS")).toBe("anthropic")
			expect(getApiProtocol("bedrock", "claude-3-opus")).toBe("anthropic")
			expect(getApiProtocol("vertex", "ClAuDe-InStAnT")).toBe("anthropic")
		})
	})
})
