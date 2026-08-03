import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { BEDROCK_ROUTING_METADATA } from "./bedrock-cache-point";
import { GLM_THINKING_ROUTING_METADATA } from "./glm-thinking";
import { MINIMAX_THINKING_ROUTING_METADATA } from "./minimax-thinking";
import { resolvePortableReasoning } from "./portable-reasoning";
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
	contextWindow?: number;
	maxOutputTokens?: number;
	reasoningOptions?: readonly ModelReasoningOption[];
	modelMetadata?: NonNullable<GatewayProviderContext["model"]["metadata"]>;
	capabilities?: GatewayProviderContext["model"]["capabilities"];
	metadata?: GatewayProviderContext["provider"]["metadata"];
	/** Test helper escape hatch for Claude-like models that should not get an auto-injected Anthropic reasoning route. */
	disableAutoAnthropicRouting?: boolean;
};

function makeContext(options?: ContextOverrides): GatewayProviderContext {
	const providerId = options?.providerId ?? "test-provider";
	const modelId = options?.modelId ?? "model-id";
	const normalizedFamily = options?.family?.toLowerCase() ?? "";
	const normalizedModelId = modelId.toLowerCase();
	const useAnthropicReasoningRoute =
		options?.disableAutoAnthropicRouting !== true &&
		(normalizedFamily.includes("claude") ||
			normalizedModelId.includes("claude") ||
			normalizedModelId.includes("anthropic"));
	const anthropicReasoningMetadata: GatewayProviderContext["provider"]["metadata"] =
		useAnthropicReasoningRoute
			? {
					routing: {
						reasoning: {
							format: "anthropic-thinking",
							routes: [
								{
									matcher: "anthropic-compatible",
								},
							],
						},
					},
				}
			: undefined;
	const metadata =
		anthropicReasoningMetadata || options?.metadata
			? {
					...(anthropicReasoningMetadata ?? {}),
					...(options?.metadata ?? {}),
					routing:
						anthropicReasoningMetadata?.routing || options?.metadata?.routing
							? {
									...(anthropicReasoningMetadata?.routing ?? {}),
									...(options?.metadata?.routing ?? {}),
								}
							: undefined,
				}
			: undefined;
	const modelMetadata =
		options?.family || options?.modelMetadata
			? {
					...options.modelMetadata,
					...(options.family ? { family: options.family } : {}),
				}
			: undefined;
	return {
		provider: {
			id: providerId,
			name: providerId,
			defaultModelId: modelId,
			models: [
				{ id: modelId, name: modelId, providerId, capabilities: ["text"] },
			],
			metadata,
		},
		model: {
			id: modelId,
			name: modelId,
			providerId,
			maxOutputTokens: options?.maxOutputTokens,
			contextWindow: options?.contextWindow,
			reasoningOptions: options?.reasoningOptions,
			capabilities: options?.capabilities,
			metadata: modelMetadata,
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

function effortOptions(
	values: Extract<ModelReasoningOption, { type: "effort" }>["values"],
): ModelReasoningOption[] {
	return [{ type: "effort", values }];
}

function budgetOptions(min: number, max?: number): ModelReasoningOption[] {
	return [
		{ type: "budget_tokens", min, ...(max === undefined ? {} : { max }) },
	];
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
		const gatewayRequest = makeRequest(request);
		const result = composeAiSdkProviderOptions(
			gatewayRequest,
			makeContext({
				providerId: request.providerId,
				modelId: request.modelId,
				...context,
			}),
		);
		if (resolvePortableReasoning(gatewayRequest)) {
			for (const bucket of Object.values(result)) {
				for (const key of [
					"effort",
					"reasoning",
					"reasoningEffort",
					"think",
					"thinking",
					"thinkingConfig",
				]) {
					expect(bucket).not.toHaveProperty(key);
				}
			}
			return;
		}
		if (request.providerId === "ollama") {
			expect(result.ollama).toHaveProperty("options.num_ctx");
			expect(result.ollama).not.toHaveProperty("think");
			return;
		}
		if (
			request.modelId.includes("kimi-k2.6") &&
			(request.reasoning === undefined ||
				Object.keys(request.reasoning).length === 0)
		) {
			for (const bucket of Object.values(result)) {
				expect(bucket).not.toHaveProperty("thinking");
			}
			return;
		}

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

		const expected = {};
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
		expect(result["vercel-ai-gateway"]).not.toHaveProperty("effort");
		expect(result["vercel-ai-gateway"]).not.toHaveProperty("reasoningSummary");
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

	it("does not emit anthropic cache_control buckets for bedrock cache-point routing", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "bedrock",
				modelId: "anthropic.claude-sonnet-4-6",
			}),
			makeContext({
				providerId: "bedrock",
				modelId: "anthropic.claude-sonnet-4-6",
				metadata: BEDROCK_ROUTING_METADATA,
			}),
		);

		expect(result.bedrock ?? {}).not.toHaveProperty("cache_control");
		expect(result.anthropic ?? {}).not.toHaveProperty("cache_control");
		expect(result.openaiCompatible ?? {}).not.toHaveProperty("cache_control");
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
			context: {
				family: "claude-sonnet",
				reasoningOptions: budgetOptions(1024),
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: MANUAL_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "Opus 4.6 clamps unsupported xhigh effort to max",
			request: {
				providerId: "anthropic",
				modelId: "claude-opus-4-6",
				reasoning: { enabled: true, effort: "xhigh" },
			},
			context: {
				family: "claude-opus",
				reasoningOptions: effortOptions(["low", "medium", "high", "max"]),
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "max" },
				},
			],
		},
		{
			name: "Fable 5 uses adaptive thinking and preserves xhigh effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-fable-5",
				reasoning: { enabled: true, effort: "xhigh" },
			},
			context: {
				family: "claude-fable",
				reasoningOptions: effortOptions([
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				]),
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "xhigh" },
				},
			],
		},
		{
			name: "Sonnet 5 uses adaptive thinking with medium effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-5",
				reasoning: { enabled: true, effort: "medium" },
			},
			context: {
				family: "claude-sonnet",
				reasoningOptions: effortOptions([
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				]),
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "medium" },
				},
			],
		},
		{
			name: "Sonnet 5 emits the explicit disabled thinking control",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-5",
				reasoning: { enabled: false },
			},
			context: {
				family: "claude-sonnet",
				reasoningOptions: [
					{ type: "toggle" },
					...effortOptions(["low", "medium", "high", "xhigh", "max"]),
				],
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: { type: "disabled" } },
					lacks: ["effort"],
				},
			],
		},
		{
			// Adaptive-era models reject the manual wire shape even though they
			// also advertise a budget_tokens control, so an explicit numeric
			// budget cannot force manual thinking; the budget is ignored.
			name: "Sonnet 4.6 explicit budget still selects adaptive thinking when effort is advertised",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				reasoning: { enabled: true, budgetTokens: 4096 },
			},
			context: {
				family: "claude-sonnet",
				reasoningOptions: [
					...effortOptions(["low", "medium", "high", "max"]),
					...budgetOptions(1024, 64_000),
				],
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "budget-only models keep manual thinking for explicit budgets",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, budgetTokens: 4096 },
			},
			context: {
				family: "claude-sonnet",
				reasoningOptions: budgetOptions(1024, 64_000),
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: { type: "enabled", budgetTokens: 4096 } },
					lacks: ["effort"],
				},
			],
		},
		{
			// Adaptive-era ids (4.6+ / 5.x) reject thinking.type "enabled", so
			// the missing-reasoningOptions fallback must infer adaptive.
			// Unlisted ids still get only broadly supported effort values, so
			// xhigh is downgraded to high.
			name: "unknown future Claude aliases without catalog options infer adaptive thinking",
			request: {
				providerId: "anthropic",
				modelId: "claude-haiku-5",
				reasoning: { enabled: true, effort: "xhigh" },
			},
			context: { family: "claude-haiku" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING, effort: "high" },
				},
			],
		},
		{
			name: "unlisted adaptive-era suffix variant without catalog options infers adaptive thinking",
			request: {
				providerId: "anthropic",
				modelId: "claude-opus-4-6:1m",
				reasoning: { enabled: true },
			},
			context: { family: "claude-opus" },
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: ADAPTIVE_THINKING },
					lacks: ["effort"],
				},
			],
		},
		{
			name: "pre-adaptive Claude ids without catalog options keep manual thinking",
			request: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				reasoning: { enabled: true },
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
		{
			// ClinePass is served by the shared "cline" AI SDK provider (same
			// Cline API), which only reads the "cline" providerOptions bucket.
			// Uses an explicit budget because effort-based reasoning is portable
			// and never reaches provider-option buckets.
			name: "ClinePass-routed Sonnet 4.5 budget -> gateway reasoning under the shared cline bucket",
			request: {
				providerId: "cline-pass",
				modelId: "anthropic/claude-sonnet-4-5",
				reasoning: { enabled: true, budgetTokens: 2048 },
			},
			context: { family: "claude-sonnet" },
			expect: [
				{
					bucket: "cline",
					has: { reasoning: { enabled: true, max_tokens: 2048 } },
					lacks: ["thinking"],
				},
			],
		},
		{
			name: "legacy custom Claude with promptCacheStrategy -> Anthropic reasoning",
			request: {
				providerId: "custom-provider",
				modelId: "anthropic/claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				disableAutoAnthropicRouting: true,
				metadata: { promptCacheStrategy: "anthropic-automatic" },
			},
			expect: [
				{
					bucket: "custom-provider",
					has: { reasoning: { enabled: true, max_tokens: 1024 } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "openaiCompatible",
					has: { reasoning: { enabled: true, max_tokens: 1024 } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
			],
		},
		{
			name: "unrouted custom Claude -> Anthropic reasoning",
			request: {
				providerId: "custom-provider",
				modelId: "anthropic/claude-3.5-sonnet",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				disableAutoAnthropicRouting: true,
			},
			expect: [
				{
					bucket: "custom-provider",
					has: { reasoning: { enabled: true, max_tokens: 1024 } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "openaiCompatible",
					has: { reasoning: { enabled: true, max_tokens: 1024 } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
			],
		},
	]);

	it.each([
		["provider cap", undefined, 200_000, 128_000],
		["output cap", 2048, 200_000, 2047],
		["small output cap", 64, 4096, 63],
	] as const)("clamps custom Anthropic explicit budgets to the %s", (_, maxTokens, budgetTokens, expected) => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-custom",
				maxTokens,
				reasoning: { enabled: true, budgetTokens },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-custom",
				family: "claude",
			}),
		);

		expect(result.anthropic).toMatchObject({
			thinking: { type: "enabled", budgetTokens: expected },
		});
		expect(result.openaiCompatible).toMatchObject({
			reasoning: { enabled: true, max_tokens: expected },
		});
	});

	it("does not enable direct Anthropic thinking when disable conflicts with a budget", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "anthropic",
				modelId: "claude-custom",
				reasoning: { enabled: false, budgetTokens: 4096 },
			}),
			makeContext({
				providerId: "anthropic",
				modelId: "claude-custom",
				family: "claude",
			}),
		);

		expect(result.anthropic).not.toHaveProperty("thinking");
	});

	it("drops conflicting Anthropic-compatible budgets after explicit disable", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "custom-provider",
				modelId: "anthropic/claude-custom",
				reasoning: { enabled: false, budgetTokens: 4096 },
			}),
			makeContext({
				providerId: "custom-provider",
				modelId: "anthropic/claude-custom",
				family: "claude",
			}),
		);

		for (const bucket of ["anthropic", "custom-provider", "openaiCompatible"]) {
			expect(result[bucket]).not.toHaveProperty("thinking.type", "enabled");
			expect(result[bucket]).not.toHaveProperty("reasoning.max_tokens");
		}
	});
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
			name: "openrouter preserves exact maximum reasoning effort",
			request: {
				providerId: "openrouter",
				modelId: "moonshotai/reasoning-model",
				reasoning: { effort: "max" },
			},
			context: {
				reasoningOptions: effortOptions(["low", "medium", "high", "max"]),
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "max" } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter preserves supported Anthropic xhigh effort",
			request: {
				providerId: "openrouter",
				modelId: "anthropic/claude-opus-4-7",
				reasoning: { effort: "xhigh" },
			},
			context: {
				family: "claude-opus",
				reasoningOptions: effortOptions([
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				]),
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "xhigh" } },
					lacks: ["thinking", "reasoningEffort"],
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
					has: { reasoning: { enabled: true, max_tokens: 19_200 } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "models.dev default effort bypasses unlisted-model heuristics",
			request: {
				providerId: "groq",
				modelId: "qwen/qwen3-32b",
				reasoning: { enabled: true },
			},
			context: {
				family: "qwen",
				reasoningOptions: effortOptions(["none", "default"]),
			},
			expect: [
				{
					bucket: "groq",
					has: { reasoningEffort: "default" },
					lacks: ["effort", "reasoningSummary"],
				},
			],
		},
		{
			name: "Anthropic default effort uses adaptive thinking without an invalid effort",
			request: {
				providerId: "anthropic",
				modelId: "claude-future",
				reasoning: { enabled: true },
			},
			context: {
				family: "claude",
				reasoningOptions: effortOptions(["none", "default"]),
			},
			expect: [
				{
					bucket: "anthropic",
					has: { thinking: { type: "adaptive" } },
					lacks: ["effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter reasoning enabled-only uses resolved output cap for reasoning budget",
			request: {
				providerId: "openrouter",
				modelId: "openai/gpt-oss-120b",
				maxTokens: 10_000,
				reasoning: { enabled: true },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { enabled: true, max_tokens: 6_000 } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter reasoning enabled-only uses model output cap when request cap is absent",
			request: {
				providerId: "openrouter",
				modelId: "openai/gpt-oss-120b",
				reasoning: { enabled: true },
			},
			context: { maxOutputTokens: 12_000 },
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { enabled: true, max_tokens: 7_200 } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter reasoning effort sends only effort (no max_tokens, which OpenRouter rejects alongside effort)",
			request: {
				providerId: "openrouter",
				modelId: "openai/gpt-oss-120b",
				reasoning: { effort: "high" },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "high" } },
					lacks: ["thinking", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter unset reasoning -> no reasoning field",
			request: {
				providerId: "openrouter",
				modelId: "deepseek/deepseek-v4-pro",
			},
			expect: [
				{
					bucket: "openrouter",
					lacks: ["reasoning", "thinking", "effort", "reasoningEffort"],
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
				metadata: { promptCacheStrategy: "anthropic-automatic" },
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
					has: { reasoning: { enabled: true, max_tokens: 19_200 } },
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
			name: "openrouter GLM thinking-disabled -> reasoning.effort=none in provider+compatible",
			request: {
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				reasoning: { enabled: false },
			},
			expect: [
				{ bucket: "openrouter", has: { reasoning: { effort: "none" } } },
				// The OpenRouter bucket is authoritative on the wire; this residual
				// compatible bucket remains for non-OpenRouter routed GLM paths.
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
			context: { family: "glm", metadata: GLM_THINKING_ROUTING_METADATA },
			expect: [
				{ bucket: "zai", has: { thinking: { type: "enabled" } } },
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "enabled" } },
					lacks: ["reasoning"],
				},
			],
		},
		{
			name: "native zai custom non-GLM -> no generic adaptive thinking",
			request: {
				providerId: "zai",
				modelId: "zai-other-model",
				reasoning: { enabled: true },
			},
			context: { family: "other", metadata: GLM_THINKING_ROUTING_METADATA },
			expect: [
				{ bucket: "zai", lacks: ["thinking", "reasoning"] },
				{ bucket: "openaiCompatible", lacks: ["thinking", "reasoning"] },
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
			name: "openrouter Kimi K2.6 family reasoning.enabled=false -> reasoning.effort=none",
			request: {
				providerId: "openrouter",
				modelId: "moonshotai/kimi-k2.6",
				reasoning: { enabled: false },
			},
			context: { family: "kimi-k2.6" },
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "none" } },
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
			name: "qwen prompt-cache-only route reasoning.enabled=true -> cache control, no thinking",
			request: {
				providerId: "qwen",
				modelId: "qwen-plus",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				family: "qwen",
				capabilities: ["text", "prompt-cache"],
				metadata: {
					routing: {
						promptCache: {
							format: "anthropic-cache-control",
							routes: [
								{
									matcher: "model-family",
									family: "qwen",
									requiredCapability: "prompt-cache",
								},
							],
						},
					},
				},
			},
			expect: [
				{
					bucket: "qwen",
					has: { cache_control: { type: "ephemeral" } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "openaiCompatible",
					has: { cache_control: { type: "ephemeral" } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
			],
		},
		{
			name: "qwen prompt-cache route without capability reasoning.enabled=true -> no generic thinking",
			request: {
				providerId: "qwen",
				modelId: "qwen-plus",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				family: "qwen",
				capabilities: ["text"],
				metadata: {
					routing: {
						promptCache: {
							format: "anthropic-cache-control",
							routes: [
								{
									matcher: "model-family",
									family: "qwen",
									requiredCapability: "prompt-cache",
								},
							],
						},
					},
				},
			},
			expect: [
				{
					bucket: "qwen",
					lacks: [
						"cache_control",
						"thinking",
						"effort",
						"reasoningEffort",
						"reasoningSummary",
					],
				},
				{
					bucket: "openaiCompatible",
					lacks: [
						"cache_control",
						"thinking",
						"effort",
						"reasoningEffort",
						"reasoningSummary",
					],
				},
			],
		},
		{
			name: "cline qwen prompt-cache-only route reasoning.enabled=true -> cache control, no gateway reasoning",
			request: {
				providerId: "cline",
				modelId: "qwen/qwen3.6-plus",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				family: "qwen",
				capabilities: ["text", "prompt-cache"],
				metadata: {
					routing: {
						promptCache: {
							format: "anthropic-cache-control",
							routes: [
								{
									matcher: "model-family",
									family: "qwen",
									requiredCapability: "prompt-cache",
								},
							],
						},
					},
				},
			},
			expect: [
				{
					bucket: "cline",
					has: { cache_control: { type: "ephemeral" } },
					lacks: [
						"reasoning",
						"thinking",
						"effort",
						"reasoningEffort",
						"reasoningSummary",
					],
				},
			],
		},
		{
			name: "cline unregistered qwen reasoning.enabled=true -> no gateway reasoning",
			request: {
				providerId: "cline",
				modelId: "qwen/qwen3.7-plus",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				metadata: {
					routing: {
						promptCache: {
							format: "anthropic-cache-control",
							routes: [
								{
									matcher: "model-family",
									family: "qwen",
									requiredCapability: "prompt-cache",
								},
							],
						},
					},
				},
			},
			expect: [
				{
					bucket: "cline",
					lacks: [
						"reasoning",
						"thinking",
						"effort",
						"reasoningEffort",
						"reasoningSummary",
					],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
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
		{
			name: "cline Claude Fable omits an unadvertised disabled control",
			request: {
				providerId: "cline",
				modelId: "anthropic/claude-fable-5",
				reasoning: { enabled: false },
			},
			context: {
				reasoningOptions: effortOptions([
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				]),
			},
			expect: [
				{
					bucket: "cline",
					lacks: ["reasoning", "thinking"],
				},
			],
		},
		{
			name: "cline Claude Fable ignores an advertised toggle because reasoning is mandatory",
			request: {
				providerId: "cline",
				modelId: "anthropic/claude-fable-5",
				reasoning: { enabled: false },
			},
			context: {
				reasoningOptions: [
					{ type: "toggle" },
					...effortOptions(["low", "medium", "high", "xhigh", "max"]),
				],
			},
			expect: [
				{
					bucket: "cline",
					lacks: ["reasoning", "thinking"],
				},
			],
		},
		{
			name: "cline StepFun 3.7 Flash reasoning.enabled=false omits disabled reasoning",
			request: {
				providerId: "cline",
				modelId: "stepfun/step-3.7-flash",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "cline",
					lacks: ["reasoning", "thinking"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["reasoning", "thinking"],
				},
			],
		},
		{
			name: "cline StepFun 3.7 Flash variants reasoning.enabled=false omit disabled reasoning",
			request: {
				providerId: "cline",
				modelId: "stepfun/step-3.7-flash-v2",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "cline",
					lacks: ["reasoning", "thinking"],
				},
			],
		},
		// OpenRouter owns the reasoning object regardless of Moonshot family.
		{
			name: "openrouter non-K2.6 Moonshot Kimi reasoning.enabled=false -> reasoning.effort=none",
			request: {
				providerId: "openrouter",
				modelId: "moonshotai/kimi-k2.5",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "none" } },
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
		{
			name: "openrouter MiniMax M3 reasoning enabled -> OpenRouter reasoning shape",
			request: {
				providerId: "openrouter",
				modelId: "minimax/minimax-m3",
				reasoning: { enabled: true },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { enabled: true, max_tokens: 19_200 } },
					lacks: ["thinking", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "openrouter MiniMax M3 reasoning disabled -> OpenRouter reasoning.effort=none",
			request: {
				providerId: "openrouter",
				modelId: "minimax/minimax-m3",
				reasoning: { enabled: false },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
			},
			expect: [
				{
					bucket: "openrouter",
					has: { reasoning: { effort: "none" } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning"],
				},
			],
		},
		{
			name: "vercel MiniMax M3 reasoning enabled -> gateway reasoning shape",
			request: {
				providerId: "vercel-ai-gateway",
				modelId: "minimax/minimax-m3",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
			},
			expect: [
				{
					bucket: "vercel-ai-gateway",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "vercelAiGateway",
					has: { reasoning: { enabled: true } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
			],
		},
		{
			name: "vercel MiniMax M3 reasoning disabled -> gateway reasoning.exclude",
			request: {
				providerId: "vercel-ai-gateway",
				modelId: "minimax/minimax-m3",
				reasoning: { enabled: false },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
			},
			expect: [
				{
					bucket: "vercel-ai-gateway",
					has: { reasoning: { exclude: true } },
					lacks: ["thinking"],
				},
				{
					bucket: "vercelAiGateway",
					has: { reasoning: { exclude: true } },
					lacks: ["thinking"],
				},
			],
		},
		{
			name: "vercel MiniMax M3 sibling without advertised controls -> no reasoning control",
			request: {
				providerId: "vercel-ai-gateway",
				modelId: "minimax/minimax-m3-pro",
				reasoning: { enabled: true },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
			},
			expect: [
				{
					bucket: "vercel-ai-gateway",
					lacks: ["thinking", "reasoning"],
				},
			],
		},
		{
			name: "cline MiniMax M3 reasoning enabled -> gateway reasoning without thinking leak",
			request: {
				providerId: "cline",
				modelId: "minimax/minimax-m3",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
			},
			expect: [
				{
					bucket: "cline",
					has: { reasoning: { enabled: true, effort: "high" } },
					lacks: ["thinking", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		{
			name: "cline MiniMax M3 reasoning disabled -> gateway reasoning disabled",
			request: {
				providerId: "cline",
				modelId: "minimax/minimax-m3",
				reasoning: { enabled: false },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
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
			name: "direct MiniMax M3 reasoning disabled -> thinking.type=disabled",
			request: {
				providerId: "minimax",
				modelId: "MiniMax-M3",
				reasoning: { enabled: false },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
				metadata: MINIMAX_THINKING_ROUTING_METADATA,
			},
			expect: [
				{
					bucket: "minimax",
					has: { thinking: { type: "disabled" } },
					lacks: ["reasoning", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "disabled" } },
					lacks: ["reasoning", "effort", "reasoningEffort", "reasoningSummary"],
				},
			],
		},
		{
			name: "direct MiniMax M3 reasoning enabled -> thinking.type=adaptive",
			request: {
				providerId: "minimax",
				modelId: "MiniMax-M3",
				reasoning: { enabled: true, effort: "high" },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
				metadata: MINIMAX_THINKING_ROUTING_METADATA,
			},
			expect: [
				{
					bucket: "minimax",
					has: { thinking: { type: "adaptive" } },
					lacks: ["reasoning", "effort", "reasoningEffort", "reasoningSummary"],
				},
				{
					bucket: "openaiCompatible",
					has: { thinking: { type: "adaptive" } },
					lacks: ["reasoning", "effort", "reasoningEffort", "reasoningSummary"],
				},
			],
		},
		{
			name: "direct MiniMax M2.5 without an advertised control -> no generic thinking",
			request: {
				providerId: "minimax",
				modelId: "MiniMax-M2.5",
				reasoning: { enabled: true },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
				metadata: MINIMAX_THINKING_ROUTING_METADATA,
			},
			expect: [
				{
					bucket: "minimax",
					lacks: ["thinking", "reasoning"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning"],
				},
			],
		},
		{
			name: "direct MiniMax M2.7 reasoning disabled -> no MiniMax M3 disabled exception",
			request: {
				providerId: "minimax",
				modelId: "MiniMax-M2.7",
				reasoning: { enabled: false },
			},
			context: {
				family: "minimax",
				capabilities: ["reasoning"],
				metadata: MINIMAX_THINKING_ROUTING_METADATA,
			},
			expect: [
				{
					bucket: "minimax",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["thinking", "reasoning", "effort", "reasoningEffort"],
				},
			],
		},
		// Ollama Qwen3: model behavior fact first, documented dynamic fallback second.
		{
			name: "ollama metadata reasoningDefaultOn disabled -> think false",
			request: {
				providerId: "ollama",
				modelId: "local-known-reasoner:latest",
				reasoning: { enabled: false },
			},
			context: { modelMetadata: { reasoningDefaultOn: true } },
			expect: [
				{
					bucket: "ollama",
					has: { think: false, options: { num_ctx: 32768 } },
				},
				{
					bucket: "openaiCompatible",
					lacks: ["think", "reasoningEffort", "reasoning"],
				},
			],
		},
		{
			name: "ollama qwen3 fallback reasoning disabled -> think false",
			request: {
				providerId: "ollama",
				modelId: "qwen3-coder:30b",
				reasoning: { enabled: false },
			},
			expect: [
				{
					bucket: "ollama",
					has: { think: false, options: { num_ctx: 32768 } },
				},
				{
					bucket: "openaiCompatible",
					lacks: ["think", "reasoningEffort", "reasoning"],
				},
			],
		},
		{
			name: "ollama qwen3 fallback reasoning enabled -> think true",
			request: {
				providerId: "ollama",
				modelId: "qwen3-coder:30b",
				reasoning: { enabled: true },
			},
			expect: [
				{
					bucket: "ollama",
					has: { think: true, options: { num_ctx: 32768 } },
					lacks: ["reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["reasoningEffort", "reasoning"] },
			],
		},
		{
			name: "ollama qwen3 fallback with unset reasoning -> think true",
			request: {
				providerId: "ollama",
				modelId: "qwen3-coder:30b",
			},
			expect: [
				{
					bucket: "ollama",
					has: { think: true, options: { num_ctx: 32768 } },
					lacks: ["reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["reasoningEffort", "reasoning"] },
			],
		},
		{
			name: "ollama metadata reasoningDefaultOn with unset reasoning -> think true",
			request: {
				providerId: "ollama",
				modelId: "local-known-reasoner:latest",
			},
			context: { modelMetadata: { reasoningDefaultOn: true } },
			expect: [
				{
					bucket: "ollama",
					has: { think: true, options: { num_ctx: 32768 } },
					lacks: ["reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["reasoningEffort", "reasoning"] },
			],
		},
		{
			name: "ollama metadata reasoningDefaultOn beats deepseek family thinking disable",
			request: {
				providerId: "ollama",
				modelId: "deepseek-r1:latest",
				reasoning: { enabled: false },
			},
			context: {
				family: "deepseek",
				modelMetadata: { reasoningDefaultOn: true },
			},
			expect: [
				{
					bucket: "ollama",
					has: { think: false, options: { num_ctx: 32768 } },
					lacks: ["thinking"],
				},
				{
					bucket: "openaiCompatible",
					lacks: ["think", "thinking", "reasoningEffort", "reasoning"],
				},
			],
		},
		{
			name: "ollama explicit disable overrides metadata reasoningDefaultOn false",
			request: {
				providerId: "ollama",
				modelId: "qwen3-coder:30b",
				reasoning: { enabled: false },
			},
			context: { modelMetadata: { reasoningDefaultOn: false } },
			expect: [
				{
					bucket: "ollama",
					has: { think: false, options: { num_ctx: 32768 } },
					lacks: ["reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["reasoningEffort", "reasoning"] },
			],
		},
		{
			name: "ollama local model explicit reasoning disabled -> think false",
			request: {
				providerId: "ollama",
				modelId: "llama3.1:8b",
				reasoning: { enabled: false },
			},
			context: { contextWindow: 65536 },
			expect: [
				{
					bucket: "ollama",
					has: { think: false, options: { num_ctx: 65536 } },
					lacks: ["reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["reasoningEffort", "reasoning"] },
			],
		},
		{
			name: "ollama unregistered deepseek-r1 explicit reasoning enabled -> think true",
			request: {
				providerId: "ollama",
				modelId: "deepseek-r1:latest",
				reasoning: { enabled: true },
			},
			expect: [
				{
					bucket: "ollama",
					has: { think: true, options: { num_ctx: 32768 } },
					lacks: ["reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["think", "reasoning"] },
			],
		},
		{
			name: "ollama unregistered model with unset reasoning omits think",
			request: {
				providerId: "ollama",
				modelId: "local-unknown:latest",
			},
			expect: [
				{
					bucket: "ollama",
					has: { options: { num_ctx: 32768 } },
					lacks: ["think", "reasoningEffort", "reasoning"],
				},
				{ bucket: "openaiCompatible", lacks: ["think", "reasoning"] },
			],
		},
	]);
});

describe("composeAiSdkProviderOptions: catalog-driven provider codecs", () => {
	it.each([
		[true, "enabled"],
		[false, "disabled"],
	] as const)("maps Moonshot toggle %s to thinking.type=%s", (enabled, type) => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "moonshot",
				modelId: "kimi-k3",
				reasoning: { enabled },
			}),
			makeContext({
				providerId: "moonshot",
				modelId: "kimi-k3",
				family: "kimi-k3",
				reasoningOptions: [{ type: "toggle" }],
			}),
		);
		if (enabled) {
			expect(result.moonshot).not.toHaveProperty("thinking");
			expect(result.openaiCompatible).not.toHaveProperty("thinking");
		} else {
			expect(result.moonshot).toMatchObject({ thinking: { type } });
			expect(result.openaiCompatible).toMatchObject({ thinking: { type } });
		}
		expect(result.moonshot).not.toHaveProperty("effort");
		expect(result.moonshot).not.toHaveProperty("reasoningSummary");
	});

	it.each([
		[
			"effort",
			{ effort: "max" },
			effortOptions(["low", "medium", "high", "max"]),
			{ reasoningEffort: "max" },
		],
		[
			"off",
			{ enabled: false },
			[{ type: "toggle" }],
			{ reasoningEffort: "none" },
		],
		[
			"on",
			{ enabled: true },
			[{ type: "toggle" }, ...effortOptions(["low", "medium", "high", "max"])],
			{ reasoningEffort: "medium" },
		],
		[
			"budget",
			{ budgetTokens: 4096 },
			budgetOptions(128, 32_768),
			{ thinking: { type: "enabled", budget_tokens: 4096 } },
		],
	] as const)("maps Fireworks %s to its supported wire shape", (_, reasoning, reasoningOptions, expected) => {
		const gatewayRequest = makeRequest({
			providerId: "fireworks",
			modelId: "accounts/fireworks/models/kimi-k3",
			reasoning,
		});
		const result = composeAiSdkProviderOptions(
			gatewayRequest,
			makeContext({
				providerId: "fireworks",
				modelId: "accounts/fireworks/models/kimi-k3",
				reasoningOptions,
			}),
		);
		if (resolvePortableReasoning(gatewayRequest)) {
			expect(result.fireworks).not.toHaveProperty("reasoningEffort");
			expect(result.fireworks).not.toHaveProperty("thinking");
			return;
		}
		expect(result.fireworks).toMatchObject(expected);
		expect(result.fireworks).not.toHaveProperty("effort");
		expect(result.fireworks).not.toHaveProperty("reasoningSummary");
		if ("thinking" in expected) {
			expect(result.fireworks).not.toHaveProperty("reasoningEffort");
		} else {
			expect(result.fireworks).not.toHaveProperty("thinking");
		}
	});

	it("maps Together off to reasoning.enabled=false", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "together",
				modelId: "zai-org/glm-5.2",
				reasoning: { enabled: false },
			}),
			makeContext({
				providerId: "together",
				modelId: "zai-org/glm-5.2",
				family: "glm",
				reasoningOptions: [{ type: "toggle" }],
			}),
		);
		expect(result.together).toMatchObject({
			reasoning: { enabled: false },
		});
		expect(result.together).not.toHaveProperty("thinking");
	});

	it("keeps Vercel Gemini budget metadata out of Anthropic headroom", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vercel-ai-gateway",
				modelId: "google/gemini-2.5-pro",
				maxTokens: 64,
				reasoning: { budgetTokens: 128 },
			}),
			makeContext({
				providerId: "vercel-ai-gateway",
				modelId: "google/gemini-2.5-pro",
				family: "gemini-pro",
				reasoningOptions: budgetOptions(128, 32_768),
				maxOutputTokens: 64,
			}),
		);
		for (const bucket of ["vercel-ai-gateway", "vercelAiGateway"]) {
			expect(result[bucket]).toMatchObject({
				reasoning: { max_tokens: 128 },
			});
			expect(result[bucket]).not.toHaveProperty("thinking");
		}
	});
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

	it("keeps portable OpenAI reasoning out of provider options", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openai-native",
				modelId: "gpt-5.6",
				reasoning: { effort: "max" },
			}),
			makeContext({
				providerId: "openai-native",
				modelId: "gpt-5.6",
				reasoningOptions: effortOptions([
					"none",
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				]),
			}),
		);

		expect(result.openai).toEqual(
			expect.objectContaining({
				truncation: "auto",
			}),
		);
		expect(result.openai).not.toHaveProperty("reasoningEffort");
		expect(result).not.toHaveProperty("openai-native");
	});

	it("keeps portable OpenAI disable out of provider options", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openai-native",
				modelId: "gpt-5.6",
				reasoning: { enabled: false },
			}),
			makeContext({
				providerId: "openai-native",
				modelId: "gpt-5.6",
				reasoningOptions: effortOptions([
					"none",
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				]),
			}),
		);

		expect(result.openai).toEqual(
			expect.objectContaining({
				truncation: "auto",
			}),
		);
		expect(result.openai).not.toHaveProperty("reasoningEffort");
	});

	it("emits the openai-codex `openai` bucket alongside provider-id and alias buckets", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				systemPrompt: "you are helpful",
				reasoning: { effort: "high" },
			}),
			makeContext({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				reasoningOptions: effortOptions(["low", "medium", "high", "xhigh"]),
			}),
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
			}),
		);
		expect(result["openai-codex"]).not.toHaveProperty("reasoningEffort");
		expect(result["openai-codex"]).not.toHaveProperty("reasoningSummary");
		expect(result["openai-codex"]).not.toHaveProperty("truncation");
		expect(result.openaiCodex).toEqual(
			expect.objectContaining({ store: false }),
		);
		expect(result.openaiCodex).not.toHaveProperty("truncation");
	});

	it("keeps portable OpenAI Codex effort out of every provider bucket", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				reasoning: { effort: "max" },
			}),
			makeContext({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				reasoningOptions: effortOptions(["low", "medium", "high", "xhigh"]),
			}),
		);

		for (const bucket of ["openai", "openai-codex", "openaiCodex"]) {
			expect(result[bucket]).not.toHaveProperty("effort");
			expect(result[bucket]).not.toHaveProperty("reasoningEffort");
		}
	});

	it("keeps Gemini effort out of provider options", () => {
		const withEffort = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				reasoning: { effort: "medium" },
			}),
			makeContext({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				reasoningOptions: [
					{ type: "toggle" },
					{ type: "budget_tokens", min: 0, max: 24_576 },
				],
			}),
		);
		expect(withEffort).not.toHaveProperty("google");

		const withoutEffort = composeAiSdkProviderOptions(
			makeRequest({ providerId: "gemini", modelId: "gemini-2.5-flash" }),
			makeContext({ providerId: "gemini", modelId: "gemini-2.5-flash" }),
		);
		expect(withoutEffort).not.toHaveProperty("google");
	});

	it("keeps exact Gemini token budgets in provider options", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				reasoning: { budgetTokens: 4096 },
			}),
			makeContext({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				reasoningOptions: budgetOptions(0, 24_576),
			}),
		);

		expect(result.google).toEqual({
			thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
		});
	});

	it("leaves Gemini level coercion to the AI SDK", () => {
		const withMinimal = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "gemini",
				modelId: "gemini-3-pro-preview",
				reasoning: { effort: "minimal" },
			}),
			makeContext({
				providerId: "gemini",
				modelId: "gemini-3-pro-preview",
				reasoningOptions: effortOptions(["low", "high"]),
			}),
		);
		expect(withMinimal).not.toHaveProperty("google");
	});

	it("does not emit a Google reasoning bucket for portable effort", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "google",
				modelId: "gemini-2.5-flash",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "google",
				modelId: "gemini-2.5-flash",
				reasoningOptions: [
					{ type: "toggle" },
					{ type: "budget_tokens", min: 0, max: 24_576 },
				],
			}),
		);

		expect(result).not.toHaveProperty("google");
	});

	it("does not emit Vertex thinkingConfig for portable effort", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vertex",
				modelId: "gemini-3-flash-preview",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "vertex",
				modelId: "gemini-3-flash-preview",
				reasoningOptions: effortOptions(["minimal", "low", "medium", "high"]),
			}),
		);

		expect(result.vertex).toEqual({});
		expect(result.vertex).not.toHaveProperty("thinking");
		expect(result.vertex).not.toHaveProperty("effort");
		expect(result.vertex).not.toHaveProperty("reasoningEffort");
		expect(result.vertex).not.toHaveProperty("reasoningSummary");
		expect(result.google).toBeUndefined();
	});

	it("uses portable reasoning for Vertex Claude", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vertex",
				modelId: "claude-sonnet-4-5",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "vertex",
				modelId: "claude-sonnet-4-5",
				family: "claude-sonnet",
				capabilities: ["text", "reasoning"],
			}),
		);

		expect(result.vertex).toEqual({});
		expect(result.vertex).not.toHaveProperty("thinkingConfig");
		expect(result.vertex).not.toHaveProperty("effort");
		expect(result.vertex).not.toHaveProperty("reasoningEffort");
		expect(result.vertex).not.toHaveProperty("reasoningSummary");
	});

	it("omits disabled Vertex thinking when the model advertises no off control", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vertex",
				modelId: "gemini-3-flash-preview",
				reasoning: { enabled: false },
			}),
			makeContext({
				providerId: "vertex",
				modelId: "gemini-3-flash-preview",
				reasoningOptions: effortOptions(["minimal", "low", "medium", "high"]),
			}),
		);

		expect(result.vertex).toEqual({});
		expect(result.vertex).not.toHaveProperty("thinking");
		expect(result.vertex).not.toHaveProperty("effort");
		expect(result.vertex).not.toHaveProperty("reasoningEffort");
		expect(result.vertex).not.toHaveProperty("reasoningSummary");
		expect(result.google).toBeUndefined();
	});

	it("uses portable reasoning to disable Vertex Gemini Flash", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vertex",
				modelId: "gemini-flash-latest",
				reasoning: { enabled: false },
			}),
			makeContext({
				providerId: "vertex",
				modelId: "gemini-flash-latest",
				family: "gemini-flash",
				capabilities: ["reasoning"],
				reasoningOptions: [
					{ type: "toggle" },
					{ type: "budget_tokens", min: 0, max: 24_576 },
				],
			}),
		);

		expect(result.vertex).toEqual({});
		expect(result.vertex).not.toHaveProperty("thinking");
		expect(result.vertex).not.toHaveProperty("effort");
		expect(result.vertex).not.toHaveProperty("reasoningEffort");
		expect(result.vertex).not.toHaveProperty("reasoningSummary");
		expect(result.google).toBeUndefined();
	});

	it("uses portable reasoning for Vertex Gemini Flash effort", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vertex",
				modelId: "gemini-flash-latest",
				reasoning: { enabled: true, effort: "high" },
			}),
			makeContext({
				providerId: "vertex",
				modelId: "gemini-flash-latest",
				family: "gemini-flash",
				capabilities: ["reasoning"],
				reasoningOptions: effortOptions(["minimal", "low", "medium", "high"]),
			}),
		);

		expect(result.vertex).toEqual({});
		expect(result.vertex).not.toHaveProperty("thinking");
		expect(result.vertex).not.toHaveProperty("effort");
		expect(result.vertex).not.toHaveProperty("reasoningEffort");
		expect(result.vertex).not.toHaveProperty("reasoningSummary");
		expect(result.google).toBeUndefined();
	});

	it("omits disabled Vertex Gemini 2.5 Pro without an advertised off control", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "vertex",
				modelId: "gemini-2.5-pro",
				reasoning: { enabled: false },
			}),
			makeContext({
				providerId: "vertex",
				modelId: "gemini-2.5-pro",
				family: "gemini-pro",
				capabilities: ["reasoning"],
				reasoningOptions: budgetOptions(128, 32_768),
			}),
		);

		expect(result.vertex).toEqual({});
		expect(result.vertex).not.toHaveProperty("thinking");
		expect(result.vertex).not.toHaveProperty("effort");
		expect(result.vertex).not.toHaveProperty("reasoningEffort");
		expect(result.vertex).not.toHaveProperty("reasoningSummary");
		expect(result.google).toBeUndefined();
	});
});

describe("composeAiSdkProviderOptions: ClinePass bucket normalization", () => {
	it("keys ClinePass options to the shared cline bucket only", () => {
		const result = composeAiSdkProviderOptions(
			makeRequest({
				providerId: "cline-pass",
				modelId: "anthropic/claude-sonnet-4-5",
				reasoning: { enabled: true, budgetTokens: 2048 },
			}),
			makeContext({
				providerId: "cline-pass",
				modelId: "anthropic/claude-sonnet-4-5",
				family: "claude-sonnet",
			}),
		);

		// The shared "cline" AI SDK provider serves both gateway ids and only
		// reads the "cline" providerOptions bucket, so nothing may be emitted
		// under the concrete "cline-pass" id or its camelCase alias.
		expect(result.cline).toEqual(
			expect.objectContaining({
				reasoning: { enabled: true, max_tokens: 2048 },
			}),
		);
		expect(result).not.toHaveProperty("cline-pass");
		expect(result).not.toHaveProperty("clinePass");
	});
});
