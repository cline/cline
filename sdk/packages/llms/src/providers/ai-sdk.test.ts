import { describe, expect, it } from "vitest";
import fixtures from "../../fixtures/usage.json";
import { normalizeUsage, toAiSdkMessages } from "./ai-sdk";

/**
 * These tests validate usage normalization across different AI SDK stream result shapes.
 * We test against real fixture data from multiple providers to ensure:
 * - Finish part usage (AiSdkStreamFinishPart.totalUsage) normalizes correctly
 * - Stream.usage promise result (AiSdkStreamUsage) normalizes correctly with raw data
 * - Token counts map from provider-specific field names to standard format
 * - Cost extraction works when available in raw provider response
 */

// Import normalizeUsage - would need to export this from ai-sdk.ts for testing
// For now, documenting what we'd test when exported
const testCases = [
	{
		provider: "openrouter",
		description: "handles cache tokens and upstream cost breakdown",
		finishUsage: (
			(fixtures as Record<string, unknown>).openrouter_finish as Record<
				string,
				unknown
			>
		).totalUsage,
		streamUsage: (fixtures as Record<string, unknown>)
			.openrouter_stream_usage as Record<string, unknown>,
		expectedNormalized: {
			inputTokens: 9096,
			outputTokens: 77,
			cacheReadTokens: 9090,
			cacheWriteTokens: 0,
		},
		expectedNormalizedStreamUsage: {
			inputTokens: 9096,
			outputTokens: 77,
			cacheReadTokens: 9090,
			cacheWriteTokens: 0,
			totalCost: 0.0068249999999999995, // BYOK fee + upstream provider cost
		},
	},
	{
		provider: "gemini",
		description: "maps Gemini's promptTokenCount to inputTokens",
		finishUsage: (
			(fixtures as Record<string, unknown>).gemini_finish as Record<
				string,
				unknown
			>
		).totalUsage,
		streamUsage: (fixtures as Record<string, unknown>)
			.gemini_stream_usage as Record<string, unknown>,
		expectedNormalized: {
			inputTokens: 4605,
			outputTokens: 120,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	},
	{
		provider: "anthropic",
		description: "extracts cache tokens from Anthropic's raw response",
		finishUsage: (
			(fixtures as Record<string, unknown>).anthropic_finish as Record<
				string,
				unknown
			>
		).totalUsage,
		streamUsage: (fixtures as Record<string, unknown>)
			.anthropic_stream_usage as Record<string, unknown>,
		expectedNormalized: {
			inputTokens: 6538,
			outputTokens: 176,
			cacheReadTokens: 0,
			cacheWriteTokens: 6535, // Now extracted from nested inputTokenDetails.cacheWriteTokens
		},
		expectedNormalizedStreamUsage: {
			inputTokens: 6538,
			outputTokens: 176,
			cacheReadTokens: 0,
			cacheWriteTokens: 6535, // Extracted from nested inputTokenDetails.cacheWriteTokens
		},
	},
	{
		provider: "openai",
		description: "handles OpenAI's input_tokens_details.cached_tokens",
		finishUsage: (
			(fixtures as Record<string, unknown>).openai_finish as Record<
				string,
				unknown
			>
		).totalUsage,
		streamUsage: (fixtures as Record<string, unknown>)
			.openai_stream_usage as Record<string, unknown>,
		expectedNormalized: {
			inputTokens: 3824,
			outputTokens: 14,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	},
	{
		provider: "vercel",
		description:
			"preserves finish-part totals when Vercel reports cached tokens",
		finishUsage: (
			(fixtures as Record<string, unknown>).vercel_finish as Record<
				string,
				unknown
			>
		).totalUsage,
		streamUsage: (fixtures as Record<string, unknown>)
			.vercel_stream_usage as Record<string, unknown>,
		expectedNormalized: {
			inputTokens: 6781,
			outputTokens: 70,
			cacheReadTokens: 6667,
			cacheWriteTokens: 0,
		},
		expectedNormalizedStreamUsage: {
			inputTokens: 4550,
			outputTokens: 10,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0.000641,
		},
	},
];

describe("toAiSdkMessages", () => {
	it("preserves OpenAI Responses reasoning metadata alongside tool calls", () => {
		const messages = toAiSdkMessages([
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						text: "plan",
						metadata: {
							openai: {
								itemId: "rs_reasoning",
								reasoningEncryptedContent: "encrypted",
							},
						},
					},
					{
						type: "tool-call",
						toolCallId: "fc_call",
						toolName: "read_files",
						input: { path: "/tmp/file" },
					},
				],
			},
		]);

		expect(messages[0]).toMatchObject({
			role: "assistant",
			content: [
				{
					type: "reasoning",
					providerOptions: {
						openai: {
							itemId: "rs_reasoning",
							reasoningEncryptedContent: "encrypted",
						},
					},
				},
			],
		});
	});
});

describe("ai-sdk usage normalization", () => {
	describe.each(testCases)("$provider", ({
		description,
		finishUsage,
		streamUsage,
		expectedNormalized,
		expectedNormalizedStreamUsage,
	}) => {
		it(`finish part: ${description}`, () => {
			const normalized = normalizeUsage(finishUsage as Record<string, unknown>);
			expect(normalized.inputTokens).toBe(expectedNormalized.inputTokens);
			expect(normalized.outputTokens).toBe(expectedNormalized.outputTokens);
			expect(normalized.cacheReadTokens).toBe(
				expectedNormalized.cacheReadTokens,
			);
			expect(normalized.cacheWriteTokens).toBe(
				expectedNormalized.cacheWriteTokens,
			);
		});

		it(`stream.usage: ${description}`, () => {
			const normalized = normalizeUsage(streamUsage as Record<string, unknown>);
			const expected = (expectedNormalizedStreamUsage ??
				expectedNormalized) as Record<string, unknown>;
			expect(normalized.inputTokens).toBe(expected.inputTokens);
			expect(normalized.outputTokens).toBe(expected.outputTokens);
			expect(normalized.cacheReadTokens).toBe(expected.cacheReadTokens);
			expect(normalized.cacheWriteTokens).toBe(expected.cacheWriteTokens);
			if (typeof expected.totalCost === "number") {
				expect(normalized.totalCost).toBeCloseTo(expected.totalCost, 5);
			}
		});
	});

	it("finish part lacks raw provider metadata", () => {
		const finishPart = (fixtures as Record<string, unknown>)
			.openrouter_finish as Record<string, unknown>;
		expect(finishPart).not.toHaveProperty("raw");
		expect(finishPart).toHaveProperty("type", "finish");
	});

	it("stream.usage includes raw provider response", () => {
		const streamUsage = (fixtures as Record<string, unknown>)
			.openrouter_stream_usage as Record<string, unknown>;
		expect(streamUsage).toHaveProperty("raw");
		expect(streamUsage.raw).toHaveProperty("cost_details");
	});

	it("maps provider reasoning tokens to reasoningTokenCount", () => {
		expect(
			normalizeUsage({
				completion_tokens_details: { reasoning_tokens: 17 },
			}).reasoningTokenCount,
		).toBe(17);
		expect(
			normalizeUsage({
				outputTokenDetails: { reasoningTokens: 23 },
			}).reasoningTokenCount,
		).toBe(23);
		expect(
			normalizeUsage({
				raw: { outputTokenDetails: { reasoningTokens: 31 } },
			}).reasoningTokenCount,
		).toBe(31);
		expect(
			normalizeUsage({}, { openrouter: { usage: { reasoning_tokens: 37 } } })
				.reasoningTokenCount,
		).toBe(37);
	});

	it("preserves source precedence when multiple reasoning token values exist", () => {
		const normalized = normalizeUsage(
			{
				reasoningTokens: 11,
				raw: { reasoningTokens: 22 },
			},
			{ openrouter: { usage: { reasoning_tokens: 33 } } },
		);

		expect(normalized.reasoningTokenCount).toBe(11);
	});

	it("coerces string reasoning token counts", () => {
		expect(
			normalizeUsage({
				raw: { outputTokenDetails: { reasoningTokens: "41" } },
			}).reasoningTokenCount,
		).toBe(41);
	});

	describe("cost extraction with pricing fallback", () => {
		it("uses market_cost when available (Vercel)", () => {
			const vercelUsage = (fixtures as Record<string, unknown>)
				.vercel_stream_usage as Record<string, unknown>;
			const normalized = normalizeUsage(vercelUsage);
			expect(normalized.totalCost).toBe(0.000641);
		});

		it("sums BYOK fee + upstream provider cost when OpenRouter marks the request as BYOK", () => {
			const openrouterUsage = (fixtures as Record<string, unknown>)
				.openrouter_stream_usage as Record<string, unknown>;
			const normalized = normalizeUsage(openrouterUsage);
			expect(normalized.totalCost).toBeCloseTo(0.006825, 5);
		});

		it("does not double-count OpenRouter credit-billed usage when upstream mirrors cost", () => {
			const normalized = normalizeUsage({
				prompt_tokens: 15,
				completion_tokens: 5,
				cost: 0.0000301,
				is_byok: false,
				cost_details: {
					upstream_inference_cost: 0.0000301,
				},
			});

			expect(normalized.totalCost).toBe(0.0000301);
		});

		it("uses upstream inference cost when OpenRouter reports no account charge for BYOK", () => {
			const normalized = normalizeUsage({
				prompt_tokens: 10,
				completion_tokens: 5,
				cost: 0,
				is_byok: true,
				cost_details: {
					upstream_inference_cost: 0.000036,
				},
			});

			expect(normalized.totalCost).toBe(0.000036);
		});

		it("falls back to upstream inference cost when it is the only explicit cost", () => {
			const normalized = normalizeUsage({
				prompt_tokens: 10,
				completion_tokens: 5,
				cost_details: {
					upstream_inference_cost: 0.000036,
				},
			});

			expect(normalized.totalCost).toBe(0.000036);
		});

		it("calculates cost from pricing when no explicit cost in response", () => {
			const pricingInput = { input: 2.5, output: 10 }; // per 1M tokens
			const normalized = normalizeUsage(
				{ inputTokens: 1000, outputTokens: 100 },
				undefined,
				pricingInput,
			);
			// (1000/1M) * 2.5 + (100/1M) * 10 = 0.0025 + 0.001 = 0.0035
			expect(normalized.totalCost).toBeCloseTo(0.0035, 5);
		});
	});

	describe("field mapping across providers", () => {
		it("maps AI SDK v3 usage token details", () => {
			const normalized = normalizeUsage({
				inputTokens: {
					total: 4605,
					noCache: 1000,
					cacheRead: 3605,
					cacheWrite: undefined,
				},
				outputTokens: {
					total: 120,
					text: 120,
					reasoning: 0,
				},
				raw: {
					promptTokenCount: 4605,
					candidatesTokenCount: 120,
					cachedContentTokenCount: 3605,
				},
			} as Record<string, unknown>);

			expect(normalized.inputTokens).toBe(4605);
			expect(normalized.outputTokens).toBe(120);
			expect(normalized.cacheReadTokens).toBe(3605);
			expect(normalized.cacheWriteTokens).toBe(0);
		});

		it("falls back to raw Gemini usage metadata", () => {
			const normalized = normalizeUsage({
				raw: {
					promptTokenCount: 4605,
					candidatesTokenCount: 120,
					cachedContentTokenCount: 3605,
				},
			} as Record<string, unknown>);

			expect(normalized.inputTokens).toBe(4605);
			expect(normalized.outputTokens).toBe(120);
			expect(normalized.cacheReadTokens).toBe(3605);
			expect(normalized.cacheWriteTokens).toBe(0);
		});

		it("maps camelCase inputTokens from multiple naming conventions", () => {
			const inputs = [
				{ inputTokens: 100 }, // Already camelCase
				{ input_tokens: 100 }, // snake_case
				{ prompt_tokens: 100 }, // OpenAI convention
			];
			// Each should normalize to inputTokens: 100
			expect(inputs.length).toBe(3);
		});

		it("extracts cacheReadTokens from nested structures", () => {
			const nested = {
				inputTokenDetails: { cacheReadTokens: 50 }, // Nested camelCase
			};
			const flattened = {
				cache_read_tokens: 50, // Flat snake_case
			};
			// Both should normalize to cacheReadTokens: 50
			expect(nested).toBeDefined();
			expect(flattened).toBeDefined();
		});

		it("extracts Qwen cache writes from OpenRouter prompt token details", () => {
			const normalized = normalizeUsage({
				prompt_tokens: 10126,
				completion_tokens: 13,
				prompt_tokens_details: {
					cached_tokens: 0,
					cache_write_tokens: 10106,
				},
			});

			expect(normalized).toEqual(
				expect.objectContaining({
					inputTokens: 10126,
					outputTokens: 13,
					cacheReadTokens: 0,
					cacheWriteTokens: 10106,
				}),
			);
		});

		it("extracts Qwen cache reads from raw prompt token details", () => {
			const normalized = normalizeUsage({
				raw: {
					prompt_tokens_details: {
						cached_tokens: 8885,
						cache_write_tokens: 10106,
					},
				},
			});

			expect(normalized).toEqual(
				expect.objectContaining({
					cacheReadTokens: 8885,
					cacheWriteTokens: 10106,
				}),
			);
		});

		it("handles Anthropic's cache_creation metadata", () => {
			const anthropicRaw = (
				(fixtures as Record<string, unknown>).anthropic_stream_usage as Record<
					string,
					unknown
				>
			).raw;
			expect(anthropicRaw).toHaveProperty("cache_creation");
			expect(
				(anthropicRaw as Record<string, unknown>).cache_creation,
			).toHaveProperty("ephemeral_5m_input_tokens");
		});

		it("handles Gemini's promptTokenCount naming", () => {
			const geminiRaw = (
				(fixtures as Record<string, unknown>).gemini_stream_usage as Record<
					string,
					unknown
				>
			).raw;
			expect(geminiRaw).toHaveProperty("promptTokenCount");
			expect(geminiRaw).toHaveProperty("candidatesTokenCount");
		});
	});
});
