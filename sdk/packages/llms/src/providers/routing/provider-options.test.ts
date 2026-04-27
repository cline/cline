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

	it("skips the `[providerId]` bucket for direct anthropic but keeps the anthropic bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				family: "claude",
			}),
		);

		expect(result.anthropic).toEqual(
			expect.objectContaining({
				thinking: { type: "adaptive" },
				effort: "high",
			}),
		);
		// The provider-id bucket is the same key as the alias ("anthropic"); both
		// branches are skipped, so the only "anthropic" bucket is the base one.
		expect(Object.keys(result).filter((k) => k === "anthropic")).toHaveLength(
			1,
		);
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
