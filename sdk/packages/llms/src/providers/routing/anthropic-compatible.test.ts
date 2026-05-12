import type {
	GatewayModelRoute,
	GatewayProviderContext,
	GatewayProviderManifest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyPromptCacheToLastTextPart,
	isAnthropicCompatibleModel,
	isAnthropicCompatibleModelId,
	isQwenModel,
	resolveAnthropicReasoningRequestPolicy,
	resolvePromptCacheRoute,
	shouldApplyPromptCache,
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
	capabilities?: GatewayProviderContext["model"]["capabilities"],
): GatewayProviderContext {
	return {
		provider: makeProvider(metadata),
		model: {
			id: "model-id",
			name: "Model",
			providerId: "test-provider",
			capabilities,
			metadata: family ? { family } : undefined,
		},
		config: {
			providerId: "test-provider",
		},
	};
}

function metadataWithRouting(options: {
	promptCacheRoutes?: GatewayModelRoute[];
	reasoningRoutes?: GatewayModelRoute[];
}): GatewayProviderManifest["metadata"] {
	return {
		routing: {
			...(options.promptCacheRoutes
				? {
						promptCache: {
							format: "anthropic-cache-control",
							routes: options.promptCacheRoutes,
						},
					}
				: {}),
			...(options.reasoningRoutes
				? {
						reasoning: {
							format: "anthropic-thinking",
							routes: options.reasoningRoutes,
						},
					}
				: {}),
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
		expect(isAnthropicCompatibleModelId("anthropic--claude-3.5-sonnet")).toBe(
			true,
		);
	});

	it("does not match unrelated model ids", () => {
		expect(isAnthropicCompatibleModelId("openai/gpt-5.4")).toBe(false);
		expect(isAnthropicCompatibleModelId("gemini-3.1-flash-lite-preview")).toBe(
			false,
		);
	});

	it("keeps Qwen outside Anthropic compatibility and routes cache by provider metadata", () => {
		expect(isAnthropicCompatibleModelId("qwen/qwen3.6-plus")).toBe(false);
		expect(isQwenModel({ modelId: "qwen/qwen3.6-plus" })).toBe(true);
		expect(isQwenModel({ modelId: "alibaba/qwen3.6-plus" })).toBe(true);
		expect(isQwenModel({ family: "qwen" })).toBe(true);
		expect(isQwenModel({ family: "qwen3.6" })).toBe(true);
		expect(isQwenModel({ modelId: "anthropic/claude-sonnet-4.6" })).toBe(false);
		expect(
			resolvePromptCacheRoute(
				{
					providerId: "test-provider",
					modelId: "qwen/qwen3.6-plus",
					messages: [],
				},
				makeContext(),
			),
		).toBeUndefined();
		expect(
			resolvePromptCacheRoute(
				{
					providerId: "test-provider",
					modelId: "alibaba/qwen3.6-plus",
					messages: [],
				},
				makeContext(
					"qwen3.6",
					metadataWithRouting({
						promptCacheRoutes: [
							{
								matcher: "model-family",
								family: "qwen",
								requiredCapability: "prompt-cache",
							},
						],
					}),
					["text", "prompt-cache"],
				),
			),
		).toEqual({
			matcher: "model-family",
			family: "qwen",
			requiredCapability: "prompt-cache",
		});
		expect(
			resolvePromptCacheRoute(
				{
					providerId: "test-provider",
					modelId: "alibaba/qwen3.6-plus",
					messages: [],
				},
				makeContext(
					"qwen",
					metadataWithRouting({
						promptCacheRoutes: [
							{
								matcher: "model-family",
								family: "qwen",
								requiredCapability: "prompt-cache",
							},
						],
					}),
					["text", "prompt-cache"],
				),
			),
		).toEqual({
			matcher: "model-family",
			family: "qwen",
			requiredCapability: "prompt-cache",
		});
		expect(
			resolvePromptCacheRoute(
				{
					providerId: "test-provider",
					modelId: "alibaba/qwen3.6-plus",
					messages: [],
				},
				makeContext(
					"qwen",
					metadataWithRouting({
						promptCacheRoutes: [
							{
								matcher: "model-family",
								family: "qwen",
								requiredCapability: "prompt-cache",
							},
						],
					}),
					["text"],
				),
			),
		).toBeUndefined();
		expect(
			resolvePromptCacheRoute(
				{
					providerId: "test-provider",
					modelId: "qwen/qwen3.6-plus",
					messages: [],
				},
				makeContext(
					undefined,
					metadataWithRouting({
						promptCacheRoutes: [
							{ matcher: "model-id", modelId: "qwen/qwen3.6-plus" },
						],
					}),
				),
			),
		).toEqual({ matcher: "model-id", modelId: "qwen/qwen3.6-plus" });
	});

	it("requires an explicit prompt-cache route", () => {
		expect(
			shouldApplyPromptCache(
				{
					providerId: "test-provider",
					modelId: "anthropic.claude-sonnet-4-5",
					messages: [],
				},
				makeContext(
					undefined,
					metadataWithRouting({
						promptCacheRoutes: [{ matcher: "anthropic-compatible" }],
					}),
				),
			),
		).toBe(true);

		expect(
			shouldApplyPromptCache(
				{
					providerId: "test-provider",
					modelId: "anthropic.claude-sonnet-4-5",
					messages: [],
				},
				makeContext(),
			),
		).toBe(false);

		expect(
			shouldApplyPromptCache(
				{
					providerId: "test-provider",
					modelId: "openai/gpt-5.4",
					messages: [],
				},
				makeContext(
					undefined,
					metadataWithRouting({
						promptCacheRoutes: [{ matcher: "anthropic-compatible" }],
					}),
				),
			),
		).toBe(false);
	});

	it("honors legacy promptCacheStrategy when routing metadata is absent", () => {
		const request = {
			providerId: "test-provider",
			modelId: "anthropic/claude-3.5-sonnet",
			messages: [],
		};
		const context = makeContext(undefined, {
			promptCacheStrategy: "anthropic-automatic",
		});

		expect(resolvePromptCacheRoute(request, context)).toEqual({
			matcher: "anthropic-compatible",
		});
		expect(shouldApplyPromptCache(request, context)).toBe(true);
		expect(
			shouldApplyPromptCache(
				{
					providerId: "test-provider",
					modelId: "openai/gpt-5.4",
					messages: [],
				},
				context,
			),
		).toBe(false);
	});

	it("preserves legacy promptCacheStrategy for custom Qwen providers", () => {
		const request = {
			providerId: "test-provider",
			modelId: "qwen/qwen3.6-plus",
			messages: [],
		};
		const context = makeContext(undefined, {
			promptCacheStrategy: "anthropic-automatic",
		});

		expect(resolvePromptCacheRoute(request, context)).toEqual({
			matcher: "model-id",
			modelId: "qwen/qwen3.6-plus",
		});
		expect(shouldApplyPromptCache(request, context)).toBe(true);
	});

	it("preserves legacy Anthropic reasoning for custom Claude providers", () => {
		const request = {
			providerId: "test-provider",
			modelId: "anthropic/claude-sonnet-4-5",
			messages: [],
		};
		const context = makeContext("claude-sonnet", {
			promptCacheStrategy: "anthropic-automatic",
		});

		expect(resolveAnthropicReasoningRequestPolicy(request, context)).toEqual({
			kind: "anthropic-manual",
		});
	});

	it("preserves unrouted Anthropic reasoning for custom Claude providers", () => {
		const request = {
			providerId: "test-provider",
			modelId: "anthropic/claude-3.5-sonnet",
			messages: [],
		};

		expect(
			resolveAnthropicReasoningRequestPolicy(request, makeContext()),
		).toEqual({
			kind: "anthropic-manual",
		});
	});

	it("does not preserve legacy Anthropic reasoning for custom Qwen providers", () => {
		const request = {
			providerId: "test-provider",
			modelId: "qwen/qwen3.6-plus",
			messages: [],
		};
		const context = makeContext("qwen", {
			promptCacheStrategy: "anthropic-automatic",
		});

		expect(resolveAnthropicReasoningRequestPolicy(request, context)).toEqual({
			kind: "none",
		});
	});

	it("keeps prompt-cache routes separate from reasoning routes", () => {
		expect(
			resolveAnthropicReasoningRequestPolicy(
				{
					providerId: "test-provider",
					modelId: "anthropic.claude-sonnet-4-5",
					messages: [],
				},
				makeContext(
					"claude-sonnet",
					metadataWithRouting({
						promptCacheRoutes: [{ matcher: "anthropic-compatible" }],
					}),
				),
			),
		).toEqual({ kind: "none" });

		expect(
			resolveAnthropicReasoningRequestPolicy(
				{
					providerId: "test-provider",
					modelId: "anthropic.claude-sonnet-4-5",
					messages: [],
				},
				makeContext(
					"claude-sonnet",
					metadataWithRouting({
						reasoningRoutes: [
							{
								matcher: "anthropic-compatible",
							},
						],
					}),
				),
			),
		).toEqual({ kind: "anthropic-manual" });
	});

	it("enables Anthropic-style prompt cache for Qwen when the provider opts in", () => {
		expect(
			shouldApplyPromptCache(
				{
					providerId: "test-provider",
					modelId: "qwen/qwen3.6-plus",
					messages: [],
				},
				makeContext(
					undefined,
					metadataWithRouting({
						promptCacheRoutes: [
							{ matcher: "model-id", modelId: "qwen/qwen3.6-plus" },
						],
					}),
				),
			),
		).toBe(true);
		expect(
			resolveAnthropicReasoningRequestPolicy(
				{
					providerId: "test-provider",
					modelId: "qwen/qwen3.6-plus",
					messages: [],
				},
				makeContext(
					undefined,
					metadataWithRouting({
						promptCacheRoutes: [
							{ matcher: "model-id", modelId: "qwen/qwen3.6-plus" },
						],
					}),
				),
			),
		).toEqual({ kind: "none" });
	});

	it("adds the non-Anthropic filler when only one text part is present", () => {
		const message = {
			content: [
				{ type: "image_url", image_url: { url: "https://example.test/a.png" } },
				{ type: "text", text: "Hello" },
			],
		};

		applyPromptCacheToLastTextPart(message, "openrouter", false);

		expect(message.content).toHaveLength(3);
		expect(message.content[1]).toMatchObject({
			type: "text",
			text: "Hello",
			providerOptions: {
				openaiCompatible: { cache_control: { type: "ephemeral" } },
				openrouter: { cache_control: { type: "ephemeral" } },
			},
		});
		expect(message.content[2]).toEqual({ type: "text", text: " " });
	});

	it("does not add the non-Anthropic filler when multiple text parts are present", () => {
		const message = {
			content: [
				{ type: "image_url", image_url: { url: "https://example.test/a.png" } },
				{ type: "text", text: "Hello" },
				{ type: "text", text: "World" },
			],
		};

		applyPromptCacheToLastTextPart(message, "openrouter", false);

		expect(message.content).toHaveLength(3);
		expect(message.content[2]).toMatchObject({
			type: "text",
			text: "World",
			providerOptions: {
				openaiCompatible: { cache_control: { type: "ephemeral" } },
				openrouter: { cache_control: { type: "ephemeral" } },
			},
		});
	});
});
