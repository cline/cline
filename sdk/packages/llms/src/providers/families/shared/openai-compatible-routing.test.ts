import { describe, expect, it } from "vitest";
import {
	isAnthropicModelId,
	isRemappedOpenAICompatibleProvider,
	shouldUseAnthropicAutomaticPromptCache,
} from "./openai-compatible-routing";

describe("openai-compatible-routing", () => {
	describe("isAnthropicModelId", () => {
		it("matches anthropic model ids case-insensitively", () => {
			expect(isAnthropicModelId("anthropic/claude-sonnet-4.6")).toBe(true);
			expect(isAnthropicModelId("Anthropic/claude-sonnet-4.6")).toBe(true);
			expect(isAnthropicModelId("openai/gpt-4.1")).toBe(false);
		});
	});

	describe("isRemappedOpenAICompatibleProvider", () => {
		it("recognizes openrouter, cline, and vercel-ai-gateway", () => {
			expect(isRemappedOpenAICompatibleProvider("openrouter")).toBe(true);
			expect(isRemappedOpenAICompatibleProvider("cline")).toBe(true);
			expect(isRemappedOpenAICompatibleProvider("vercel-ai-gateway")).toBe(
				true,
			);
			expect(isRemappedOpenAICompatibleProvider("deepseek")).toBe(false);
		});

		it("matches remapped providers case-insensitively", () => {
			expect(isRemappedOpenAICompatibleProvider("OpenRouter")).toBe(true);
			expect(isRemappedOpenAICompatibleProvider("CLINE")).toBe(true);
			expect(isRemappedOpenAICompatibleProvider("Vercel-Ai-Gateway")).toBe(
				true,
			);
		});
	});

	describe("shouldUseAnthropicAutomaticPromptCache", () => {
		it("returns true only when all gating conditions are satisfied", () => {
			expect(
				shouldUseAnthropicAutomaticPromptCache({
					modelId: "anthropic/claude-sonnet-4.6",
					providerId: "openrouter",
					supportsPromptCache: true,
				}),
			).toBe(true);
		});

		it("returns false when prompt-cache support is disabled", () => {
			expect(
				shouldUseAnthropicAutomaticPromptCache({
					modelId: "anthropic/claude-sonnet-4.6",
					providerId: "openrouter",
					supportsPromptCache: false,
				}),
			).toBe(false);
		});

		it("returns false for non-Anthropic models", () => {
			expect(
				shouldUseAnthropicAutomaticPromptCache({
					modelId: "google/gemma-4-31b-it",
					providerId: "openrouter",
					supportsPromptCache: true,
				}),
			).toBe(false);
		});

		it("returns false for non-remapped providers", () => {
			expect(
				shouldUseAnthropicAutomaticPromptCache({
					modelId: "anthropic/claude-sonnet-4.6",
					providerId: "deepseek",
					supportsPromptCache: true,
				}),
			).toBe(false);
		});
	});
});
