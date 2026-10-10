// Wire-contract tests for Gemini reasoning and output limits, exercised
// through the *real* `@ai-sdk/google` adapter. Each case streams one turn
// through the gateway with a stubbed fetch and asserts on the request body's
// `generationConfig`. Together they pin:
//
//   1. models that advertise thinking levels but no token budget never get
//      `thinkingBudget`, which they reject; an effort still becomes a level;
//   2. models that advertise a budget keep getting the exact `thinkingBudget`;
//   3. models the catalog does not describe get no `thinkingBudget`, and the
//      AI SDK picks the thinking shape from the effort;
//   4. thinking counts toward the output limit, so the default limit is not
//      lowered below the 32K default, and an explicit larger limit passes
//      through up to the model's advertised maximum.
import type { GatewayStreamRequest, ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const LEVELS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high"] },
];
const BUDGET: readonly ModelReasoningOption[] = [
	{ type: "budget_tokens", min: 128, max: 32_768 },
];

async function generationConfig(input: {
	modelId: string;
	reasoning?: GatewayStreamRequest["reasoning"];
	reasoningOptions?: readonly ModelReasoningOption[];
	maxOutputTokens?: number;
	maxTokens?: number;
}): Promise<Record<string, unknown>> {
	let body: Record<string, unknown> | undefined;
	const fetchStub = (async (_input, init) => {
		body = JSON.parse((init?.body as string) ?? "{}");
		return new Response(JSON.stringify({ error: { message: "stub" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "gemini",
				apiKey: "test-key",
				fetch: fetchStub,
				...(input.reasoningOptions || input.maxOutputTokens
					? {
							models: [
								{
									id: input.modelId,
									name: input.modelId,
									capabilities: ["text", "reasoning"],
									contextWindow: 1_048_576,
									...(input.maxOutputTokens
										? { maxOutputTokens: input.maxOutputTokens }
										: {}),
									...(input.reasoningOptions
										? { reasoningOptions: input.reasoningOptions }
										: {}),
								},
							],
						}
					: {}),
			},
		],
	});
	for await (const _event of await gateway.stream({
		providerId: "gemini",
		modelId: input.modelId,
		reasoning: input.reasoning,
		...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
		messages: [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 0,
			},
		],
	})) {
		// drain
	}
	if (!body) {
		throw new Error("the stubbed fetch was never called");
	}
	return (body.generationConfig ?? {}) as Record<string, unknown>;
}

const LEVEL_MODEL = {
	modelId: "gemini-level-model",
	reasoningOptions: LEVELS,
} as const;

describe("Gemini thinking wire contract", () => {
	it("sends an effort as thinkingLevel", async () => {
		const config = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { effort: "high" },
		});
		expect(config.thinkingConfig).toEqual({ thinkingLevel: "high" });
	});

	it("never sends thinkingBudget to a level-only model", async () => {
		const budgetOnly = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { budgetTokens: 4096 },
		});
		expect(budgetOnly).not.toHaveProperty("thinkingConfig");

		const withEffort = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { effort: "high", budgetTokens: 4096 },
		});
		expect(withEffort.thinkingConfig).toEqual({ thinkingLevel: "high" });
	});

	it("keeps an exact budget for a model that advertises one", async () => {
		const config = await generationConfig({
			modelId: "gemini-budget-model",
			reasoning: { budgetTokens: 4096 },
			reasoningOptions: BUDGET,
		});
		expect(config.thinkingConfig).toEqual({
			thinkingBudget: 4096,
			includeThoughts: true,
		});
	});

	it("sends no thinking level when the model advertises no off option", async () => {
		const config = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { enabled: false },
		});
		expect(config).not.toHaveProperty("thinkingConfig");
	});

	it("leaves an unlisted model's thinking level alone when disabling", async () => {
		// The adapter would otherwise guess a minimum level from the model id,
		// which the model may reject.
		const config = await generationConfig({
			modelId: "gemini-unlisted-model",
			reasoning: { enabled: false },
		});
		expect(config).not.toHaveProperty("thinkingConfig");
	});

	it("sends no thinkingBudget to a model the catalog does not describe", async () => {
		const budgetOnly = await generationConfig({
			modelId: "gemini-unlisted-model",
			reasoning: { budgetTokens: 4096 },
		});
		expect(budgetOnly).not.toHaveProperty("thinkingConfig");

		const withEffort = await generationConfig({
			modelId: "gemini-unlisted-model",
			reasoning: { effort: "high", budgetTokens: 4096 },
		});
		expect(withEffort.thinkingConfig).toEqual({ thinkingLevel: "high" });
	});
});

describe("Gemini output limit wire contract", () => {
	it.each([
		32_768, 65_536,
	])("defaults to the 32K limit for a %d-token model", async (maxOutputTokens) => {
		const config = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { effort: "high" },
			maxOutputTokens,
		});
		expect(config.maxOutputTokens).toBe(32_000);
	});

	it("passes a larger explicit limit up to the advertised maximum", async () => {
		const config = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { effort: "high" },
			maxOutputTokens: 1_048_576,
			maxTokens: 262_144,
		});
		expect(config.maxOutputTokens).toBe(262_144);
	});

	it("clamps an explicit limit to the advertised maximum", async () => {
		const config = await generationConfig({
			...LEVEL_MODEL,
			reasoning: { effort: "high" },
			maxOutputTokens: 32_768,
			maxTokens: 262_144,
		});
		expect(config.maxOutputTokens).toBe(32_768);
	});
});
