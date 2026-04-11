import { describe, expect, it } from "vitest";
import type { GatewayProviderContext, GatewayProviderManifest } from "@clinebot/shared";
import {
	isAnthropicCompatibleModel,
	isAnthropicCompatibleModelId,
	resolvePromptCacheStrategy,
	shouldUseAnthropicPromptCache,
} from "./anthropic-compatible";

function makeProvider(
	metadata?: GatewayProviderManifest["metadata"],
): GatewayProviderManifest {
	return {
		id: "test-provider",
		name: "Test Provider",
		defaultModelId: "default-model",
		models: [
			{
				id: "default-model",
				name: "Default Model",
				providerId: "test-provider",
				capabilities: ["text"],
			},
		],
		metadata,
	};
}

function makeContext(
	family?: string,
	metadata?: GatewayProviderManifest["metadata"],
): GatewayProviderContext {
	return {
		provider: makeProvider(metadata),
		model: {
			id: "model-id",
			name: "Model",
			providerId: "test-provider",
			metadata: family ? { family } : undefined,
		},
		config: {
			providerId: "test-provider",
		},
	};
}

describe("anthropic-compatible routing helpers", () => {
	it("matches family metadata case-insensitively", () => {
		expect(
			isAnthropicCompatibleModel({
				family: "Claude-Sonnet",
			}),
		).toBe(true);
	});

	it("falls back to model id when family is whitespace-only", () => {
		expect(
			isAnthropicCompatibleModel({
				family: "   ",
				modelId: "anthropic.claude-sonnet-4-6",
			}),
		).toBe(true);
	});

	it("recognizes bedrock and sap-style anthropic model ids", () => {
		expect(isAnthropicCompatibleModelId("anthropic.claude-sonnet-4-6")).toBe(
			true,
		);
		expect(
			isAnthropicCompatibleModelId("eu.anthropic.claude-opus-4-6-v1"),
		).toBe(true);
		expect(
			isAnthropicCompatibleModelId("anthropic--claude-3.5-sonnet"),
		).toBe(true);
	});

	it("does not match unrelated model ids", () => {
		expect(isAnthropicCompatibleModelId("openai/gpt-5.4")).toBe(false);
		expect(isAnthropicCompatibleModelId("gemini-3.1-flash-lite-preview")).toBe(
			false,
		);
	});

	it("resolves only the supported prompt cache strategy", () => {
		expect(
			resolvePromptCacheStrategy(
				makeProvider({ promptCacheStrategy: "anthropic-automatic" }),
			),
		).toBe("anthropic-automatic");
		expect(
			resolvePromptCacheStrategy(
				makeProvider({ promptCacheStrategy: "invalid" as never }),
			),
		).toBeUndefined();
		expect(resolvePromptCacheStrategy(makeProvider())).toBeUndefined();
	});

	it("requires both anthropic compatibility and strategy for prompt cache", () => {
		expect(
			shouldUseAnthropicPromptCache(
				{
					providerId: "test-provider",
					modelId: "anthropic.claude-sonnet-4-6",
					messages: [],
				},
				makeContext(undefined, { promptCacheStrategy: "anthropic-automatic" }),
			),
		).toBe(true);

		expect(
			shouldUseAnthropicPromptCache(
				{
					providerId: "test-provider",
					modelId: "anthropic.claude-sonnet-4-6",
					messages: [],
				},
				makeContext(undefined),
			),
		).toBe(false);

		expect(
			shouldUseAnthropicPromptCache(
				{
					providerId: "test-provider",
					modelId: "openai/gpt-5.4",
					messages: [],
				},
				makeContext(undefined, { promptCacheStrategy: "anthropic-automatic" }),
			),
		).toBe(false);
	});
});
