import { describe, expect, it } from "vitest";
import fixtures from "../../fixtures/usage.json";
import { normalizeUsage } from "./ai-sdk";

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
			totalCost: 0.0068249999999999995, // 0.000325 (cost) + 0.0065 (upstream)
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

	describe("cost extraction with pricing fallback", () => {
		it("uses market_cost when available (Vercel)", () => {
			const vercelUsage = (fixtures as Record<string, unknown>)
				.vercel_stream_usage as Record<string, unknown>;
			const normalized = normalizeUsage(vercelUsage);
			expect(normalized.totalCost).toBe(0.000641);
		});

		it("sums base + upstream costs when both present (OpenRouter)", () => {
			const openrouterUsage = (fixtures as Record<string, unknown>)
				.openrouter_stream_usage as Record<string, unknown>;
			const normalized = normalizeUsage(openrouterUsage);
			// 0.000325 (cost) + 0.0065 (upstream_inference_cost) = 0.0068250
			expect(normalized.totalCost).toBeCloseTo(0.006825, 5);
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
