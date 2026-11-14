// Wire-contract tests for reasoning effort on native OpenAI, exercised
// through the *real* `@ai-sdk/openai` Responses adapter (openai.test.ts mocks
// the constructor). The adapter writes the AI SDK's top-level `reasoning`
// value to the request as `reasoning.effort` unchanged for every model except
// the GPT-6 Sol/Luna family, whose efforts it validates itself, so whatever
// level the gateway picks is what the endpoint receives. Each case streams
// one turn through the gateway with a stubbed fetch and asserts on the
// request body. Together they pin:
//
//   1. a level above the model's advertised ladder is snapped to its top
//      advertised level, so models whose catalog stops at `xhigh` (GPT-5.5,
//      5.4, 5.3-codex, 5.2) or `high` (GPT-5.1, 5-mini, o3) are not sent a
//      `max` they reject;
//   2. `max` reaches the wire for models that advertise it;
//   3. models the catalog does not describe get the requested level as-is.
import type { GatewayStreamRequest, ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const PROVIDER_ID = "openai-native";
/** GPT-5.4's catalog ladder. */
const THROUGH_XHIGH: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["none", "low", "medium", "high", "xhigh"] },
];
/** GPT-5.1's catalog ladder. */
const THROUGH_HIGH: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["none", "low", "medium", "high"] },
];
/** GPT-6.1 Sol's catalog ladder. */
const THROUGH_MAX: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

/**
 * Stream one turn and return the request body that reached the stubbed fetch.
 * The stub answers 400: only the request is under test. Passing
 * `reasoningOptions: undefined` leaves the model out of the provider config,
 * so the gateway resolves it as an unlisted id with no catalog facts.
 */
async function wireBody(input: {
	modelId: string;
	reasoning: GatewayStreamRequest["reasoning"];
	reasoningOptions: readonly ModelReasoningOption[] | undefined;
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
				providerId: PROVIDER_ID,
				apiKey: "test-key",
				fetch: fetchStub,
				// A config model overrides a builtin of the same id, so these
				// definitions decide what the gateway sees regardless of the catalog.
				...(input.reasoningOptions
					? {
							models: [
								{
									id: input.modelId,
									name: input.modelId,
									capabilities: ["text", "reasoning"],
									reasoningOptions: input.reasoningOptions,
								},
							],
						}
					: {}),
			},
		],
	});
	if (!input.reasoningOptions) {
		expect(
			gateway.listModels(PROVIDER_ID).map((model) => model.id),
		).not.toContain(input.modelId);
	}
	for await (const _event of await gateway.stream({
		providerId: PROVIDER_ID,
		modelId: input.modelId,
		reasoning: input.reasoning,
		maxTokens: 16,
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
	return body;
}

function sentEffort(body: Record<string, unknown>): unknown {
	return (body.reasoning as { effort?: unknown } | undefined)?.effort;
}

describe("native OpenAI reasoning effort wire contract", () => {
	it.each([
		["gpt-5.4", THROUGH_XHIGH, "xhigh"],
		["gpt-5.1", THROUGH_HIGH, "high"],
		["gpt-6.1-sol", THROUGH_MAX, "max"],
	] as const)("sends %s its top advertised level for max", async (modelId, ladder, expected) => {
		const body = await wireBody({
			modelId,
			reasoning: { effort: "max" },
			reasoningOptions: ladder,
		});
		expect(sentEffort(body)).toBe(expected);
	});

	it("sends an advertised level unchanged", async () => {
		const body = await wireBody({
			modelId: "gpt-5.4",
			reasoning: { effort: "high" },
			reasoningOptions: THROUGH_XHIGH,
		});
		expect(sentEffort(body)).toBe("high");
	});

	it("sends max unchanged for a model the catalog does not list", async () => {
		const body = await wireBody({
			modelId: "gpt-5.4-finetune",
			reasoning: { effort: "max" },
			reasoningOptions: undefined,
		});
		expect(sentEffort(body)).toBe("max");
	});
});
