import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	composeAiSdkProviderOptions,
	mergeProviderOptionPatches,
	type ProviderOptionsPatch,
} from "./provider-options";

type RequestOverrides = Partial<GatewayStreamRequest> & {
	providerId: string;
	modelId: string;
};

type ContextOverrides = {
	providerId?: string;
	modelId?: string;
	family?: string;
	capabilities?: GatewayProviderContext["model"]["capabilities"];
	providerMetadata?: GatewayProviderContext["provider"]["metadata"];
};

function makeContext(options?: ContextOverrides): GatewayProviderContext {
	const providerId = options?.providerId ?? "test-provider";
	const modelId = options?.modelId ?? "model-id";
	return {
		provider: {
			id: providerId,
			name: providerId,
			defaultModelId: modelId,
			metadata: options?.providerMetadata,
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

function makeRequest(overrides: RequestOverrides): GatewayStreamRequest {
	return {
		providerId: overrides.providerId,
		modelId: overrides.modelId,
		messages: overrides.messages ?? [
			{
				id: "msg-1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 0,
			},
		],
		systemPrompt: overrides.systemPrompt,
		temperature: overrides.temperature,
		maxTokens: overrides.maxTokens,
		reasoning: overrides.reasoning,
		signal: overrides.signal,
		tools: overrides.tools,
	};
}

/**
 * One row asserts: build a request+context, call composeAiSdkProviderOptions,
 * then for each `expect` entry check that the named bucket either contains or
 * lacks the specified shape. `has` runs through `objectContaining`; `lacks` is
 * a list of property names that must NOT exist in the bucket.
 */
type BucketExpectation = {
	bucket: string;
	has?: Record<string, unknown>;
	lacks?: string[];
};

type Case = {
	name: string;
	request: RequestOverrides;
	context?: ContextOverrides;
	expect: BucketExpectation[];
};

function runCases(cases: ReadonlyArray<Case>) {
	it.each(cases)("$name", ({ request, context, expect: expectations }) => {
		const result = composeAiSdkProviderOptions(
			makeRequest(request),
			makeContext({
				providerId: request.providerId,
				modelId: request.modelId,
				...context,
			}),
		);

		for (const e of expectations) {
			const bucket = result[e.bucket];
			if (e.has) {
				expect(bucket).toEqual(expect.objectContaining(e.has));
			}
			if (e.lacks?.length) {
				expect(bucket).toBeDefined();
			}
			for (const key of e.lacks ?? []) {
				expect(bucket).not.toHaveProperty(key);
			}
		}
	});
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

describe("composeAiSdkProviderOptions: alias bucket emission", () => {
	it("emits a concrete provider-id bucket and a distinct camelCase alias bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vercel-ai-gateway",
				modelId: "gpt-5.4",
				reasoning: { effort: "high" },
			}),
			makeContext({ providerId: "vercel-ai-gateway", modelId: "gpt-5.4" }),
		);

		const expected = {
			effort: "high",
			reasoningEffort: "high",
			reasoningSummary: "auto",
		};
		expect(result["vercel-ai-gateway"]).toEqual(
			expect.objectContaining({
				...expected,
				strictJsonSchema: false,
			}),
		);
		expect(result.vercelAiGateway).toEqual(
			expect.objectContaining({
				...expected,
				strictJsonSchema: false,
			}),
		);
		expect(result.openaiCompatible).toEqual(
			expect.objectContaining({ strictJsonSchema: false }),
		);
	});

	it("disables strict JSON schema for the OpenAI adapter bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({ providerId: "openai-native", modelId: "gpt-5.4" }),
			makeContext({ providerId: "openai-native", modelId: "gpt-5.4" }),
		);

		expect(result.openai).toEqual(
			expect.objectContaining({
				strictJsonSchema: false,
				truncation: "auto",
			}),
		);
		expect(result).not.toHaveProperty("openai-native");
		expect(result).not.toHaveProperty("openaiNative");
		expect(result.openaiCompatible).not.toHaveProperty("strictJsonSchema");
	});

	it("uses the OpenAI adapter bucket for OpenAI Responses compatible providers", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({ providerId: "v0", modelId: "v0-1.5-md" }),
			makeContext({ providerId: "v0", modelId: "v0-1.5-md" }),
			"openai",
		);

		expect(result.openai).toEqual(
			expect.objectContaining({ strictJsonSchema: false }),
		);
		expect(result.openai).not.toHaveProperty("truncation");
		expect(result).not.toHaveProperty("v0");
		expect(result.openaiCompatible).not.toHaveProperty("strictJsonSchema");
	});

	it("does not fan OpenAI-compatible strict schema defaults into native adapter buckets", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({ providerId: "bedrock", modelId: "anthropic.claude-3-5" }),
			makeContext({ providerId: "bedrock", modelId: "anthropic.claude-3-5" }),
		);

		expect(result.bedrock).not.toHaveProperty("strictJsonSchema");
		expect(result.openaiCompatible).not.toHaveProperty("strictJsonSchema");
	});

	it("does not emit a separate alias bucket when the alias equals the provider id", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({ providerId: "openai", modelId: "gpt-5" }),
			makeContext({ providerId: "openai", modelId: "gpt-5" }),
		);

		expect(result).toHaveProperty("openai");
		expect(Object.keys(result).filter((k) => k === "openai")).toHaveLength(1);
	});
});

describe("composeAiSdkProviderOptions: Anthropic thinking precedence", () => {
	const MANUAL_THINKING = { type: "enabled", budgetTokens: 1024 };
	const ADAPTIVE_THINKING = { type: "adaptive" };

	runCases([
		{
			name: "Sonnet 4.5 -> manual thinking (no adaptive support), no effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-sonnet" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "Opus 4.6 -> adaptive thinking with effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-opus-4-6",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-opus" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "high" },
				},
			],
		},
		{
			name: "Opus 4.7 -> adaptive thinking with effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-opus-4-7",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-opus" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "high" },
				},
			],
		},
		{
			name: "Opus before 4.6 -> manual thinking, no effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-opus-4-5",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-opus" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "Sonnet 4.6 -> adaptive thinking with effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-sonnet" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "high" },
				},
			],
		},
		{
			name: "future Claude major (Sonnet 5.0) -> adaptive thinking",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-5-0",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-sonnet" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "high" },
				},
			],
		},
		{
			name: "Claude date suffixes are not mistaken for adaptive version numbers",
			request: {
				providerId: "anthropic",
				modelId: "claude-opus-4-20250514",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-opus" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "Haiku 4.5 -> manual thinking, no effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-haiku-4-5",
				reasoning: { enabled: true, effort: "high" },
			},
			context: { family: "claude-haiku" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "manual thinking budget defaults when only reasoning.enabled is set",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true },
			},
			context: { family: "claude-sonnet" },
			expect: [{ bucket: "anthropic", has: { thinking: MANUAL_THINKING } }],
		},
		{
			name: "manual thinking budget defaults when maxTokens is too small",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				maxTokens: 512,
				reasoning: { enabled: true, effort: "low" },
			},
			context: { family: "claude-sonnet" },
			expect: [{ bucket: "anthropic", has: { thinking: MANUAL_THINKING } }],
		},
		{
			name: "manual thinking budget defaults for unknown effort values",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "minimal" as "low" },
			},
			context: { family: "claude-sonnet" },
			expect: [{ bucket: "anthropic", has: { thinking: MANUAL_THINKING } }],
		},
		{
			name: "lower reasoning model (Sonnet 4.0) -> manual thinking, no effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-0",
				reasoning: { enabled: true, effort: "medium" },
			},
			context: { family: "claude-sonnet", capabilities: ["reasoning"] },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "lower reasoning model (Sonnet 3.7) -> manual thinking, no effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-3-7-sonnet-20250219",
				reasoning: { enabled: true, effort: "medium" },
			},
			context: { family: "claude-sonnet", capabilities: ["reasoning"] },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "lower non-reasoning Sonnet 3.5 -> no thinking on either bucket",
			request: {
				providerId: "anthropic",
				modelId: "claude-3-5-sonnet-20241022",
				reasoning: { enabled: true, effort: "low" },
			},
			context: { family: "claude-sonnet", capabilities: ["text"] },
			expect: [
				{ bucket: "anthropic", lacks: ["thinking", "effort"] },
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "effort", "reasoning"],
				},
			],
		},
		{
			name: "lower non-reasoning Haiku 3 -> no thinking on either bucket",
			request: {
				providerId: "anthropic",
				modelId: "claude-3-haiku-20240307",
				reasoning: { enabled: true, effort: "low" },
			},
			context: { family: "claude-haiku", capabilities: ["text"] },
			expect: [
				{ bucket: "anthropic", lacks: ["thinking", "effort"] },
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "effort", "reasoning"],
				},
			],
		},
		{
			name: "Cline-routed Sonnet 4.5 -> gateway reasoning, no thinking, no effort",
			request: {
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "low" },
			},
			context: { family: "claude-sonnet" },
			expect: [
				{
					bucket: "cline",
					has: { reasoning: { enabled: true, max_tokens: 1024 } },
					lacks: ["thinking"],
				},
			],
		},
	]);
});

describe("composeAiSdkProviderOptions: family/provider thinking patches", () => {
	runCases([
		{
			name: "openrouter reasoning budgetTokens -> reasoning.max_tokens",
			request: {
				providerId: "openrouter",
				modelId: "openai/gpt-oss-120b",
				reasoning: { budgetTokens: 1024 },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { max_tokens: 1024 } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter reasoning enabled-only -> reasoning.enabled",
			request: {
				providerId: "openrouter",
				modelId: "openai/gpt-oss-120b",
				reasoning: { enabled: true },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter Qwen family -> prompt cache buckets without Anthropic thinking",
			request: {
				providerId: "openrouter",
				modelId: "alibaba/qwen3.6-plus",
			},
			context: {
				family: "qwen",
				providerMetadata: { promptCacheStrategy: "anthropic-automatic" },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { cache_control: { type: "ephemeral" } },
					lacks: ["thinking", "effort", "reasoning"],
				},
				{
					bucket: "openaiCompatible",
					has: { cache_control: { type: "ephemeral" } },
					lacks: ["thinking", "effort", "reasoning"],
				},
			],
		},
		// GLM/Z.AI routed reasoning — enabled
		{
			name: "openrouter GLM thinking-enabled -> routed reasoning, no thinking leak",
			request: {
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: true },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking"],
				},
			],
		},
		{
			name: "openrouter GLM budgetTokens -> OpenRouter max_tokens is not overwritten by routed GLM",
			request: {
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: true, budgetTokens: 1024 },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { max_tokens: 1024 } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking"],
				},
			],
		},
		{
			name: "openrouter GLM effort -> OpenRouter effort is not overwritten by routed GLM",
			request: {
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: true, effort: "medium" },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "medium" } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking"],
				},
			],
		},
		{
			name: "vercel-ai-gateway GLM thinking-enabled -> provider+alias buckets, no thinking leak",
			request: {
				providerId: "vercel-ai-gateway",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: true },
			},
			expect: [
				{
					bucket: "vercel-ai-gateway",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking"],
				},
				{
					bucket: "vercelAiGateway",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking"],
				},
				{ bucket: "openaiCompatible", lacks: ["thinking"] },
			],
		},
		// GLM/Z.AI routed reasoning — disabled
		{
			name: "openrouter GLM thinking-disabled -> reasoning.exclude in provider+compatible",
			request: {
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: false },
			},
			expect: [
				{ bucket: "openrouter", has: { reasoning: { exclude: true } } },
				{ bucket: "openaiCompatible", has: { reasoning: { exclude: true } } },
			],
		},
		{
			name: "vercel-ai-gateway GLM thinking-disabled -> reasoning.exclude in provider+alias",
			request: {
				providerId: "vercel-ai-gateway",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: false },
			},
			expect: [
				{ bucket: "vercel-ai-gateway", has: { reasoning: { exclude: true } } },
				{ bucket: "vercelAiGateway", has: { reasoning: { exclude: true } } },
			],
		},
		{
			name: "cline GLM thinking-disabled -> routed reasoning only, no thinking leak",
			request: {
				providerId: "cline",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "cline",
					has: { reasoning: { exclude: true } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					has: { reasoning: { exclude: true } },
					lacks: ["thinking"],
				},
			],
		},
		// Native Z.AI uses a real thinking shape, not the routed reasoning shape
		{
			name: "native zai thinking -> thinking.type=enabled, no routed reasoning",
			request: {
				providerId: "zai",
				modelId: "glm-4.7",
				reasoning: { enabled: true },
			},
			expect: [
				{ bucket: "zai", has: { thinking: { type: "enabled" } } },
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "enabled" } },
					lacks: ["reasoning"],
				},
			],
		},
		// Kimi K2.6 family: explicit enabled/disabled and unset defaults to enabled
		{
			name: "cline Kimi K2.6 family reasoning.enabled=false -> thinking.type=disabled",
			request: {
				providerId: "cline",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			},
			context: { family: "kimi-k2.6" },
			expect: [
				{ bucket: "cline", has: { thinking: { type: "disabled" } } },
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "cline Kimi K2.6 family reasoning.enabled=true -> thinking.type=enabled",
			request: {
				providerId: "cline",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: true },
			},
			context: { family: "kimi-k2.6" },
			expect: [
				{ bucket: "cline", has: { thinking: { type: "enabled" } } },
				{ bucket: "openaiCompatible", has: { thinking: { type: "enabled" } } },
			],
		},
		{
			name: "cline generic reasoning.enabled=false -> gateway reasoning only, no thinking patch",
			request: {
				providerId: "cline",
				modelId: "gpt-5.4",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "cline",
					has: { reasoning: { enabled: false } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning"],
				},
			],
		},
		{
			name: "cline non-K2.6 Moonshot Kimi reasoning.enabled=false -> thinking.type=disabled",
			request: {
				providerId: "cline",
				modelId: "moonshotai/kimi-k2.5",
				reasoning: { enabled: false },
			},
			context: { family: "kimi-k2.5" },
			expect: [
				{
					bucket: "cline",
					has: {
						reasoning: { enabled: false },
						thinking: { type: "disabled" },
					},
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "openrouter Kimi K2.6 family reasoning.enabled=false -> reasoning.exclude",
			request: {
				providerId: "openrouter",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			},
			context: { family: "kimi-k2.6" },
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { exclude: true } },
					lacks: ["thinking"],
				},
				{ bucket: "openaiCompatible", lacks: ["thinking"] },
			],
		},
		{
			name: "openai-compatible Kimi K2.6 family unset reasoning -> thinking.type=enabled",
			request: { providerId: "openai-compatible", modelId: "kimi-k2.6" },
			context: { family: "kimi-k2.6" },
			expect: [
				{
					bucket: "openai-compatible",
					has: { thinking: { type: "enabled" } },
				},
				{ bucket: "openaiCompatible", has: { thinking: { type: "enabled" } } },
			],
		},
		{
			name: "openai-compatible Kimi K2.6 family reasoning.enabled=false -> thinking.type=disabled",
			request: {
				providerId: "openai-compatible",
				modelId: "kimi-k2.6",
				reasoning: { enabled: false },
			},
			context: { family: "kimi-k2.6" },
			expect: [
				{
					bucket: "openai-compatible",
					has: { thinking: { type: "disabled" } },
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "openai-compatible Kimi K2.6 family empty reasoning -> thinking.type=enabled",
			request: {
				providerId: "openai-compatible",
				modelId: "kimi-k2.6",
				reasoning: {},
			},
			context: { family: "kimi-k2.6" },
			expect: [
				{ bucket: "openaiCompatible", has: { thinking: { type: "enabled" } } },
			],
		},
		{
			name: "cline Kimi K2.6 family reasoning.enabled=false also keeps gateway reasoning shape",
			request: {
				providerId: "cline",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			},
			context: { family: "kimi-k2.6" },
			expect: [{ bucket: "cline", has: { reasoning: { enabled: false } } }],
		},
		// OpenRouter owns the reasoning object regardless of Moonshot family.
		{
			name: "openrouter non-K2.6 Moonshot Kimi reasoning.enabled=false -> reasoning.exclude",
			request: {
				providerId: "openrouter",
				modelId: "moonshotai/kimi-k2.5",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { exclude: true } },
					lacks: ["thinking"],
				},
				{ bucket: "openaiCompatible", lacks: ["thinking"] },
			],
		},
		// DeepSeek family — direct provider id and openai-compatible via family
		{
			name: "direct deepseek reasoning disable -> thinking.type=disabled",
			request: {
				providerId: "deepseek",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: false },
			},
			expect: [
				{ bucket: "deepseek", has: { thinking: { type: "disabled" } } },
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "direct deepseek reasoning enable -> thinking.type=enabled",
			request: {
				providerId: "deepseek",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: true },
			},
			expect: [
				{ bucket: "deepseek", has: { thinking: { type: "enabled" } } },
				{ bucket: "openaiCompatible", has: { thinking: { type: "enabled" } } },
			],
		},
		{
			name: "openai-compatible deepseek family reasoning.enabled=false -> thinking.type=disabled",
			request: {
				providerId: "openai-compatible",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: false },
			},
			context: { family: "deepseek" },
			expect: [
				{
					bucket: "openai-compatible",
					has: { thinking: { type: "disabled" } },
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "openai-compatible deepseek-thinking family reasoning.enabled=false -> thinking.type=disabled",
			request: {
				providerId: "openai-compatible",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: false },
			},
			context: { family: "deepseek-thinking" },
			expect: [
				{
					bucket: "openai-compatible",
					has: { thinking: { type: "disabled" } },
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "openai-compatible deepseek-flash family reasoning.enabled=false -> thinking.type=disabled",
			request: {
				providerId: "openai-compatible",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: false },
			},
			context: { family: "deepseek-flash" },
			expect: [
				{
					bucket: "openai-compatible",
					has: { thinking: { type: "disabled" } },
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
				},
			],
		},
		{
			name: "openai-compatible deepseek family reasoning.enabled=true -> thinking.type=enabled",
			request: {
				providerId: "openai-compatible",
				modelId: "deepseek-v4-pro",
				reasoning: { enabled: true },
			},
			context: { family: "deepseek-thinking" },
			expect: [
				{
					bucket: "openai-compatible",
					has: { thinking: { type: "enabled" } },
				},
				{ bucket: "openaiCompatible", has: { thinking: { type: "enabled" } } },
			],
		},
		{
			name: "openai-compatible deepseek family with unset reasoning -> no thinking emitted",
			request: { providerId: "openai-compatible", modelId: "deepseek-v4-pro" },
			context: { family: "deepseek" },
			expect: [
				{ bucket: "openai-compatible", lacks: ["thinking"] },
				{ bucket: "openaiCompatible", lacks: ["thinking"] },
			],
		},
	]);
});

describe("composeAiSdkProviderOptions: provider-specific overlays", () => {
	it.each([
		"openai",
		"openai-native",
	])("emits truncation for native OpenAI provider %s", (providerId) => {
		const result = composeAiSdkProviderOptions(
			makeRequest({ providerId, modelId: "gpt-5.4" }),
			makeContext({ providerId, modelId: "gpt-5.4" }),
		);

		expect(result.openai).toHaveProperty("truncation", "auto");
	});

	it("emits the openai-codex `openai` bucket alongside provider-id and alias buckets", () => {
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
		expect(result.openai).not.toHaveProperty("truncation");
		expect(result["openai-codex"]).toEqual(
			expect.objectContaining({
				store: false,
				reasoningEffort: "high",
				reasoningSummary: "auto",
			}),
		);
		expect(result["openai-codex"]).not.toHaveProperty("truncation");
		expect(result.openaiCodex).toEqual(
			expect.objectContaining({ store: false }),
		);
		expect(result.openaiCodex).not.toHaveProperty("truncation");
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
