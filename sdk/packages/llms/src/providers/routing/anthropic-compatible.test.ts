import type {
	GatewayModelRoute,
	GatewayProviderContext,
	GatewayProviderManifest,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	isAnthropicCompatibleModel,
	isAnthropicCompatibleModelId,
	isClaudeModelId,
	isGlmModel,
	isQwenModel,
	resolveClaudeThinkingEra,
} from "../model-facts";
import {
	applyPromptCacheToLastTextPart,
	buildAnthropicProviderOptions,
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
		expect(
			isAnthropicCompatibleModel({
				family: "Anthropic",
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
		expect(isAnthropicCompatibleModelId("custom/anthropic-alias")).toBe(true);
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

	it("keeps Vertex Claude detection scoped to model id", () => {
		expect(isClaudeModelId("anthropic.claude-sonnet-4-6")).toBe(true);
		expect(isClaudeModelId("anthropic-vertex-experimental")).toBe(false);
	});

	it("matches GLM when either family or model id contains glm", () => {
		expect(
			isGlmModel({ modelId: "provider/glm-4.6" }, makeContext("other-family")),
		).toBe(true);
		expect(
			isGlmModel({ modelId: "provider/other-model" }, makeContext("zai-glm")),
		).toBe(true);
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

	it("classifies Claude model ids into thinking eras", () => {
		const adaptiveEraIds = [
			"claude-sonnet-5",
			"claude-sonnet-5:1m",
			"claude-opus-5",
			"claude-opus-4-6",
			"claude-opus-4-6:1m",
			"claude-opus-4-8",
			"claude-sonnet-4.6",
			"claude-sonnet-5-20260629",
			"anthropic.claude-opus-4-7-v1:0",
			"anthropic/claude-haiku-5",
			"claude-opus-6",
		];
		for (const modelId of adaptiveEraIds) {
			expect(resolveClaudeThinkingEra(modelId), modelId).toBe("adaptive");
		}

		const legacyEraIds = [
			"claude-sonnet-4-5",
			"claude-sonnet-4-5-20250929",
			"claude-haiku-4-5-20251001",
			"claude-opus-4-1",
			"claude-opus-4",
			"claude-3-7-sonnet",
			"claude-3-5-sonnet-20241022",
			"claude-2.1",
			"claude-instant-1.2",
		];
		for (const modelId of legacyEraIds) {
			expect(resolveClaudeThinkingEra(modelId), modelId).toBe("legacy");
		}

		// Unrecognized Claude ids are treated as newer than the known model
		// list (forward-compatible, matches @ai-sdk/anthropic's defaults).
		const unknownClaudeIds = [
			"claude-fable-5",
			"claude-nova-2",
			"claude-custom",
			"us.anthropic.claude-future-9-20990101-v1:0",
		];
		for (const modelId of unknownClaudeIds) {
			expect(resolveClaudeThinkingEra(modelId), modelId).toBe("unknown-claude");
		}

		const nonClaudeIds = ["custom/anthropic-alias", "gpt-5.4", undefined];
		for (const modelId of nonClaudeIds) {
			expect(resolveClaudeThinkingEra(modelId), modelId ?? "undefined").toBe(
				"not-claude",
			);
		}
	});

	it("infers adaptive reasoning for adaptive-era Claude ids when catalog options are missing", () => {
		const context = makeContext(
			"claude-sonnet",
			metadataWithRouting({
				reasoningRoutes: [{ matcher: "anthropic-compatible" }],
			}),
		);
		const makeRequest = (
			modelId: string,
			reasoning?: { enabled?: boolean; budgetTokens?: number },
		) => ({
			providerId: "test-provider",
			modelId,
			messages: [],
			...(reasoning ? { reasoning } : {}),
		});

		expect(
			resolveAnthropicReasoningRequestPolicy(
				makeRequest("claude-sonnet-5"),
				context,
			),
		).toEqual({ kind: "anthropic-adaptive" });
		// Adaptive-era ids stay adaptive even with an explicit budget: the
		// API rejects the manual shape outright.
		expect(
			resolveAnthropicReasoningRequestPolicy(
				makeRequest("claude-opus-4-6:1m", {
					enabled: true,
					budgetTokens: 4096,
				}),
				context,
			),
		).toEqual({ kind: "anthropic-adaptive" });
		// Pre-adaptive ids keep the manual wire shape.
		expect(
			resolveAnthropicReasoningRequestPolicy(
				makeRequest("claude-sonnet-4-5"),
				context,
			),
		).toEqual({ kind: "anthropic-manual" });
		// Unknown Claude ids default to adaptive (forward-compatible)...
		expect(
			resolveAnthropicReasoningRequestPolicy(
				makeRequest("claude-custom"),
				context,
			),
		).toEqual({ kind: "anthropic-adaptive" });
		// ...unless the request carries an explicit numeric budget, which
		// signals a custom endpoint that expects the manual shape.
		expect(
			resolveAnthropicReasoningRequestPolicy(
				makeRequest("claude-custom", { enabled: true, budgetTokens: 4096 }),
				context,
			),
		).toEqual({ kind: "anthropic-manual" });
	});

	it("keeps adaptive when a numeric budget is requested but the model advertises effort", () => {
		const baseContext = makeContext(
			"claude-sonnet",
			metadataWithRouting({
				reasoningRoutes: [{ matcher: "anthropic-compatible" }],
			}),
		);
		const request = {
			providerId: "test-provider",
			modelId: "claude-sonnet-4-6",
			messages: [],
			reasoning: { enabled: true, budgetTokens: 4096 },
		};

		expect(
			resolveAnthropicReasoningRequestPolicy(request, {
				...baseContext,
				model: {
					...baseContext.model,
					reasoningOptions: [
						{ type: "effort", values: ["low", "medium", "high", "max"] },
						{ type: "budget_tokens", min: 1024 },
					],
				},
			}),
		).toEqual({ kind: "anthropic-adaptive" });

		// Budget-only models still honor the explicit budget via manual.
		expect(
			resolveAnthropicReasoningRequestPolicy(request, {
				...baseContext,
				model: {
					...baseContext.model,
					reasoningOptions: [{ type: "budget_tokens", min: 1024 }],
				},
			}),
		).toEqual({ kind: "anthropic-manual" });
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

describe("buildAnthropicProviderOptions computer-use beta header", () => {
	function makeRequest(
		overrides: Partial<GatewayStreamRequest> = {},
	): GatewayStreamRequest {
		return {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			messages: [],
			...overrides,
		};
	}

	it("sends the computer-use beta header for the direct anthropic wire target", () => {
		const options = buildAnthropicProviderOptions(
			makeRequest(),
			makeContext("anthropic"),
			"anthropic",
		);

		expect(options.anthropicBeta).toEqual(["computer-use-2025-11-24"]);
	});

	it("does not send the beta header for other Anthropic-lineage wire targets", () => {
		const bedrockOptions = buildAnthropicProviderOptions(
			makeRequest({ providerId: "bedrock" }),
			makeContext("anthropic"),
			"bedrock",
		);
		expect(bedrockOptions.anthropicBeta).toBeUndefined();

		const vertexOptions = buildAnthropicProviderOptions(
			makeRequest({ providerId: "vertex" }),
			makeContext("anthropic"),
			"vertex",
		);
		expect(vertexOptions.anthropicBeta).toBeUndefined();
	});

	it("does not send the beta header when target is omitted", () => {
		const options = buildAnthropicProviderOptions(
			makeRequest(),
			makeContext("anthropic"),
		);

		expect(options.anthropicBeta).toBeUndefined();
	});
});
