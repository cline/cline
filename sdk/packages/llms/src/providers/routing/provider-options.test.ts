import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@clinebot/shared";
import { describe, expect, it } from "vitest";
import {
	composeAiSdkProviderOptions,
	mergeProviderOptionPatches,
	type ProviderOptionsPatch,
} from "./provider-options";

function makeContext(options?: {
	providerId?: string;
	modelId?: string;
	family?: string;
	capabilities?: GatewayProviderContext["model"]["capabilities"];
}): GatewayProviderContext {
	const providerId = options?.providerId ?? "test-provider";
	const modelId = options?.modelId ?? "model-id";
	return {
		provider: {
			id: providerId,
			name: providerId,
			defaultModelId: modelId,
			models: [
				{ id: modelId, name: modelId, providerId, capabilities: ["text"] },
			],
		},
		model: {
			id: modelId,
			name: modelId,
			providerId,
			capabilities: options?.capabilities,
			metadata: options?.family ? { family: options.family } : undefined,
		},
		config: { providerId },
	};
}

function makeRequest(
	overrides: Partial<GatewayStreamRequest> & {
		providerId: string;
		modelId: string;
	},
): GatewayStreamRequest {
	return {
		providerId: overrides.providerId,
		modelId: overrides.modelId,
		messages: overrides.messages ?? [
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		],
		systemPrompt: overrides.systemPrompt,
		temperature: overrides.temperature,
		maxTokens: overrides.maxTokens,
		reasoning: overrides.reasoning,
		signal: overrides.signal,
		tools: overrides.tools,
	};
}

describe("mergeProviderOptionPatches", () => {
	it("returns an empty object when no patches are supplied", () => {
		expect(mergeProviderOptionPatches([])).toEqual({});
	});

	it("ignores undefined patches", () => {
		const patch: ProviderOptionsPatch = { foo: { a: 1 } };
		expect(mergeProviderOptionPatches([undefined, patch, undefined])).toEqual({
			foo: { a: 1 },
		});
	});

	it("merges disjoint buckets", () => {
		expect(
			mergeProviderOptionPatches([{ foo: { a: 1 } }, { bar: { b: 2 } }]),
		).toEqual({ foo: { a: 1 }, bar: { b: 2 } });
	});

	it("later patches win on overlapping keys within the same bucket", () => {
		expect(
			mergeProviderOptionPatches([
				{ foo: { a: 1, b: 2 } },
				{ foo: { b: 99, c: 3 } },
			]),
		).toEqual({ foo: { a: 1, b: 99, c: 3 } });
	});

	it("preserves keys from earlier patches that later patches do not override", () => {
		expect(
			mergeProviderOptionPatches([
				{ foo: { a: 1 } },
				{ foo: { b: 2 } },
				{ foo: { c: 3 } },
			]),
		).toEqual({ foo: { a: 1, b: 2, c: 3 } });
	});
});

describe("composeAiSdkProviderOptions precedence", () => {
	it("emits a concrete `[providerId]` bucket and a distinct camelCase alias bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vercel-ai-gateway",
				modelId: "gpt-5.4",
				reasoning: { effort: "high" },
			}),
			makeContext({ providerId: "vercel-ai-gateway", modelId: "gpt-5.4" }),
		);

		// The concrete provider id wins for its own bucket.
		expect(result["vercel-ai-gateway"]).toEqual(
			expect.objectContaining({
				effort: "high",
				reasoningEffort: "high",
				reasoningSummary: "auto",
			}),
		);
		// The camelCase alias is also populated as a separate bucket.
		expect(result.vercelAiGateway).toEqual(
			expect.objectContaining({
				effort: "high",
				reasoningEffort: "high",
				reasoningSummary: "auto",
			}),
		);
	});

	it("does not emit a separate alias bucket when the alias equals the provider id", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({ providerId: "openai", modelId: "gpt-5" }),
			makeContext({ providerId: "openai", modelId: "gpt-5" }),
		);

		expect(result).toHaveProperty("openai");
		// `toProviderOptionsKey("openai") === "openai"`, so no separate alias bucket.
		expect(Object.keys(result).filter((k) => k === "openai")).toHaveLength(1);
	});

	it("uses thinking.type=enabled for Sonnet 4.5 which does not support adaptive thinking", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				family: "claude-sonnet",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
		expect(result.anthropic.effort).toBeUndefined();
	});

	it.each([
		"claude-opus-4-6",
		"claude-opus-4-7",
	])("uses thinking.type=adaptive for %s", (modelId) => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId,
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId,
				family: "claude-opus",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "adaptive" },
				effort: "high",
			}),
		);
	});

	it("uses manual thinking for Opus before 4.6", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-opus-4-5",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-opus-4-5",
				family: "claude-opus",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
		expect(result.anthropic).not.toHaveProperty("effort");
	});

	it("uses thinking.type=adaptive for Sonnet 4.6", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				family: "claude-sonnet",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "adaptive" },
				effort: "high",
			}),
		);
	});

	it("defaults future Claude major versions to adaptive thinking", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-5-0",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-5-0",
				family: "claude-sonnet",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "adaptive" },
				effort: "high",
			}),
		);
	});

	it("does not mistake Claude date suffixes for adaptive version numbers", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-opus-4-20250514",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-opus-4-20250514",
				family: "claude-opus",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
		expect(result.anthropic).not.toHaveProperty("effort");
	});

	it("uses thinking.type=enabled for Haiku 4.5", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-haiku-4-5",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-haiku-4-5",
				family: "claude-haiku",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
		expect(result.anthropic.effort).toBeUndefined();
	});

	it("defaults manual thinking budget when only reasoning.enabled is set", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				family: "claude-sonnet",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
	});

	it("defaults manual thinking budget when maxTokens is too small", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				maxTokens: 512,
				reasoning: { enabled: true, effort: "low" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				family: "claude-sonnet",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
	});

	it("defaults manual thinking budget for unknown effort values", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "minimal" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				family: "claude-sonnet",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
	});

	it.each([
		["claude-sonnet-4-0", "claude-sonnet"],
		["claude-3-7-sonnet-20250219", "claude-sonnet"],
	])("uses manual thinking for lower reasoning model %s", (modelId, family) => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId,
				reasoning: { enabled: true, effort: "medium" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId,
				family,
				capabilities: ["reasoning"],
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "enabled", budgetTokens: 1024 },
			}),
		);
		expect(result.anthropic).not.toHaveProperty("effort");
	});

	it.each([
		["claude-3-5-sonnet-20241022", "claude-sonnet"],
		["claude-3-haiku-20240307", "claude-haiku"],
	])("does not emit thinking for lower non-reasoning model %s", (modelId, family) => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId,
				reasoning: { enabled: true, effort: "low" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId,
				family,
				capabilities: ["text"],
			}),
		);

		expect(result.anthropic).not.toHaveProperty("thinking");
		expect(result.anthropic).not.toHaveProperty("effort");
		expect(result.openaiCompatible).not.toHaveProperty("thinking");
		expect(result.openaiCompatible).not.toHaveProperty("effort");
		expect(result.openaiCompatible).not.toHaveProperty("reasoning");
	});

	it("routes Cline Sonnet 4.5 reasoning without adaptive thinking or effort", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "low" },
			}),
			makeContext({
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4-5",
				family: "claude-sonnet",
			}),
		);

		expect(result.cline).toEqual(
			expect.objectContaining({
				reasoning: { enabled: true, max_tokens: 1024 },
			}),
		);
		expect(result.cline).not.toHaveProperty("thinking");
		expect(result.cline.reasoning).not.toHaveProperty("effort");
	});
});

describe("composeAiSdkProviderOptions provider-specific overlays", () => {
	it("routes routed-GLM thinking-enabled without leaking adaptive thinking into shared compatible buckets", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: true },
			}),
			makeContext({ providerId: "openrouter", modelId: "z-ai/glm-4.7" }),
		);

		expect(result.openrouter).toEqual(
			expect.objectContaining({ reasoning: { enabled: true } }),
		);
		expect(result.openrouter).not.toHaveProperty("thinking");
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ reasoning: { enabled: true } }),
		);
		expect(result.openaiCompatible).not.toHaveProperty("thinking");
	});

	it("routes routed-GLM thinking-enabled into both provider-id and alias buckets without adaptive thinking", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vercel-ai-gateway",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: true },
			}),
			makeContext({ providerId: "vercel-ai-gateway", modelId: "z-ai/glm-4.7" }),
		);

		expect(result["vercel-ai-gateway"]).toEqual(
			expect.objectContaining({ reasoning: { enabled: true } }),
		);
		expect(result["vercel-ai-gateway"]).not.toHaveProperty("thinking");
		expect(result.vercelAiGateway).toEqual(
			expect.objectContaining({ reasoning: { enabled: true } }),
		);
		expect(result.vercelAiGateway).not.toHaveProperty("thinking");
		expect(result.openaiCompatible).not.toHaveProperty("thinking");
	});

	it("routes routed-GLM thinking-disabled into the provider-id and shared compatible buckets", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: false },
			}),
			makeContext({ providerId: "openrouter", modelId: "z-ai/glm-4.7" }),
		);

		// GLM disable overlay wins inside the provider-id bucket. (`openrouter`
		// has no hyphen so the alias bucket is the same key.)
		expect(result.openrouter).toEqual(
			expect.objectContaining({ reasoning: { exclude: true } }),
		);
		// And it also shows up in the shared compatible bucket.
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ reasoning: { exclude: true } }),
		);
	});

	it("routes routed-GLM thinking-disabled into both provider-id and the camelCase alias bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vercel-ai-gateway",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: false },
			}),
			makeContext({ providerId: "vercel-ai-gateway", modelId: "z-ai/glm-4.7" }),
		);

		expect(result["vercel-ai-gateway"]).toEqual(
			expect.objectContaining({ reasoning: { exclude: true } }),
		);
		expect(result.vercelAiGateway).toEqual(
			expect.objectContaining({ reasoning: { exclude: true } }),
		);
	});

	it("routes cline kimi disable into thinking.type=disabled", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "cline",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			}),
			makeContext({ providerId: "cline", modelId: "moonshotai/kimi-k2.6" }),
		);

		expect(result.cline).toEqual(
			expect.objectContaining({ thinking: { type: "disabled" } }),
		);
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ thinking: { type: "disabled" } }),
		);
	});

	it("routes openrouter kimi disable into thinking.type=disabled", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openrouter",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			}),
			makeContext({
				providerId: "openrouter",
				modelId: "moonshotai/kimi-k2.6",
			}),
		);

		expect(result.openrouter).toEqual(
			expect.objectContaining({ thinking: { type: "disabled" } }),
		);
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ thinking: { type: "disabled" } }),
		);
	});

	it("preserves reasoning.enabled=false on the cline gateway bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "cline",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			}),
			makeContext({ providerId: "cline", modelId: "moonshotai/kimi-k2.6" }),
		);

		expect(result.cline).toEqual(
			expect.objectContaining({ reasoning: { enabled: false } }),
		);
	});

	it("routes direct deepseek reasoning disable to thinking.type=disabled", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "deepseek",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: false },
			}),
			makeContext({ providerId: "deepseek", modelId: "deepseek-v4-pro" }),
		);

		expect(result.deepseek).toEqual(
			expect.objectContaining({ thinking: { type: "disabled" } }),
		);
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ thinking: { type: "disabled" } }),
		);
	});

	it("routes direct deepseek reasoning enable to thinking.type=enabled", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "deepseek",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: true },
			}),
			makeContext({ providerId: "deepseek", modelId: "deepseek-v4-pro" }),
		);

		expect(result.deepseek).toEqual(
			expect.objectContaining({ thinking: { type: "enabled" } }),
		);
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ thinking: { type: "enabled" } }),
		);
	});

	it("uses native Z.AI thinking shape on the provider-id bucket without the routed reasoning shape", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "zai",
				modelId: "glm-4.7",
				reasoning: { enabled: true },
			}),
			makeContext({ providerId: "zai", modelId: "glm-4.7" }),
		);

		expect(result.zai).toEqual(
			expect.objectContaining({ thinking: { type: "enabled" } }),
		);
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ thinking: { type: "enabled" } }),
		);
		// Native Z.AI does not emit the routed `reasoning` shape.
		expect(result.openaiCompatible).not.toHaveProperty("reasoning");
	});

	it("emits the openai-codex `openai` bucket alongside the provider-id and alias buckets", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				systemPrompt: "you are helpful",
				reasoning: { effort: "high" },
			}),
			makeContext({ providerId: "openai-codex", modelId: "gpt-5.4" }),
		);

		expect(result.openai).toEqual(
			expect.objectContaining({
				instructions: "you are helpful",
				store: false,
				systemMessageMode: "remove",
			}),
		);
		expect(result["openai-codex"]).toEqual(
			expect.objectContaining({
				store: false,
				reasoningEffort: "high",
				reasoningSummary: "auto",
			}),
		);
		expect(result.openaiCodex).toEqual(
			expect.objectContaining({ store: false }),
		);
	});

	it("emits the gemini google.thinkingConfig only when reasoning effort is set", () => {
		const withEffort = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				reasoning: { effort: "medium" },
			}),
			makeContext({ providerId: "gemini", modelId: "gemini-2.5-flash" }),
		);
		expect(withEffort.google).toEqual({
			thinkingConfig: { thinkingLevel: "medium", includeThoughts: true },
		});

		const withoutEffort = composeAiSdkProviderOptions(
			makeRequest({ providerId: "gemini", modelId: "gemini-2.5-flash" }),
			makeContext({ providerId: "gemini", modelId: "gemini-2.5-flash" }),
		);
		expect(withoutEffort).not.toHaveProperty("google");
	});

	it("keeps the google bucket owned by the gemini patch for direct google providers", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "google",
				modelId: "gemini-2.5-flash",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({ providerId: "google", modelId: "gemini-2.5-flash" }),
		);

		expect(result.google).toEqual({
			thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
		});
		expect(result.google).not.toHaveProperty("thinking");
		expect(result.google).not.toHaveProperty("effort");
		expect(result.google).not.toHaveProperty("reasoningEffort");
		expect(result.google).not.toHaveProperty("reasoningSummary");
	});
});
