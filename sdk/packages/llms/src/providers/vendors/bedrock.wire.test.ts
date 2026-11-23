// Wire-contract tests for Bedrock reasoning, exercised through the *real*
// `@ai-sdk/amazon-bedrock` adapter (bedrock.test.ts mocks the constructor).
// Each case streams one turn through the gateway with a stubbed fetch and
// asserts on the `additionalModelRequestFields` the adapter put on the
// Converse request. Together they pin the adapter floor:
//
//   1. OpenAI models reached through inference profiles (`us.openai.*`,
//      `global.openai.*`) get `reasoning.effort`, the field Bedrock accepts,
//      not the generic `reasoningConfig` that adapters before 5.0.65 emitted
//      for any id they did not recognise (cline/cline#14451, vercel/ai#19403);
//   2. models the adapter cannot classify get no reasoning fields at all,
//      instead of a `reasoningConfig` Bedrock rejects for models without
//      reasoning support — adapters before 5.0.96 sent it for every
//      non-Anthropic id (cline/cline#14095, vercel/ai#21487);
//   3. the families the adapter does classify keep their native shapes from
//      the id alone even when the catalog does not list the model, so a
//      catalog that lags a model launch never switches thinking off.
import type { GatewayStreamRequest, ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const EFFORT_OPTIONS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

/**
 * What the model catalog says about the model under test. Every case states
 * this explicitly and registers the model on the provider config, so model
 * selection never depends on the generated catalog. Model-id resolution
 * still does (`resolveBedrockModelId` routes bare profile-only ids through a
 * geo profile), which is why the cases below use already-prefixed ids.
 */
type CatalogFact =
	/** Listed, and advertises a user-facing effort control. */
	| "advertises-effort"
	/** Listed, but advertises no reasoning control. */
	| "no-controls"
	/**
	 * Not in the catalog at all, e.g. an inference-profile ARN. The helper
	 * asserts this against the gateway's model list, so a catalog sync that
	 * adds the id fails the case instead of silently testing the listed path.
	 */
	| "unlisted";

interface WireRequest {
	/** Path of the Converse request, which carries the id the vendor resolved. */
	path: string | undefined;
	/** `additionalModelRequestFields` the adapter built; `null` when none. */
	sent: Record<string, unknown> | null | undefined;
}

/**
 * Stream one turn for `modelId` and return what reached the stubbed fetch.
 * The stub answers 400: only the request is under test.
 */
async function wireRequest(
	modelId: string,
	reasoning: GatewayStreamRequest["reasoning"],
	catalog: CatalogFact = "advertises-effort",
): Promise<WireRequest> {
	let path: string | undefined;
	let sent: Record<string, unknown> | null | undefined;
	const fetchStub = (async (input, init) => {
		path = decodeURIComponent(new URL(String(input)).pathname);
		const body = JSON.parse((init?.body as string) ?? "{}");
		sent = body.additionalModelRequestFields ?? null;
		return new Response(JSON.stringify({ message: "stub" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
	const gateway = createGateway({
		providerConfigs: [
			{
				providerId: "bedrock",
				apiKey: "test-bearer-key",
				fetch: fetchStub,
				options: { region: "us-east-1", authentication: "apikey" },
				// A config model overrides a builtin of the same id, so these
				// definitions decide what the gateway sees regardless of the catalog.
				...(catalog === "unlisted"
					? {}
					: {
							models: [
								{
									id: modelId,
									name: modelId,
									capabilities:
										catalog === "advertises-effort"
											? ["text", "reasoning"]
											: ["text"],
									...(catalog === "advertises-effort"
										? { reasoningOptions: EFFORT_OPTIONS }
										: {}),
								},
							],
						}),
			},
		],
	});
	if (catalog === "unlisted") {
		expect(
			gateway.listModels("bedrock").map((model) => model.id),
		).not.toContain(modelId);
	}
	for await (const _event of await gateway.stream({
		providerId: "bedrock",
		modelId,
		reasoning,
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
	return { path, sent };
}

describe("Bedrock reasoning wire contract", () => {
	it.each([
		"us.openai.gpt-6-astra",
		"global.openai.gpt-5.6-luna",
	])("sends reasoning.effort for inference-profile OpenAI model %s", async (modelId) => {
		const { path, sent } = await wireRequest(modelId, { effort: "high" });
		expect(path).toBe(`/model/${modelId}/converse-stream`);
		expect(sent).toEqual({ reasoning: { effort: "high" } });
	});

	it("sends reasoning.effort for a bare OpenAI id, whichever profile the resolver picks", async () => {
		const { path, sent } = await wireRequest("openai.gpt-6-astra", {
			effort: "high",
		});
		expect(path).toMatch(
			/\/model\/(?:[a-z-]+\.)?openai\.gpt-6-astra\/converse-stream$/,
		);
		expect(sent).toEqual({ reasoning: { effort: "high" } });
	});

	it("sends no reasoning fields for an unlisted inference-profile ARN", async () => {
		const { sent } = await wireRequest(
			"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123",
			{ effort: "medium" },
			"unlisted",
		);
		expect(sent).toBeNull();
	});

	it("sends no reasoning fields for a model the adapter cannot classify, even when the catalog lists it", async () => {
		// Nova Micro has no reasoning support; the adapter (5.0.96+) drops the
		// portable option for it rather than emitting `reasoningConfig`.
		const { sent } = await wireRequest(
			"us.amazon.nova-micro-v1:0",
			{ effort: "high" },
			"no-controls",
		);
		expect(sent).toBeNull();
	});

	it("keeps thinking for a Claude id the catalog does not list", async () => {
		// Sonnet 4 is not in the generated catalog; the adapter derives the
		// Anthropic shape from the id, so the budget must still go out.
		const { sent } = await wireRequest(
			"us.anthropic.claude-sonnet-4-20250514-v1:0",
			{ effort: "high" },
			"unlisted",
		);
		expect(sent).toMatchObject({
			thinking: { type: "enabled", budget_tokens: expect.any(Number) },
		});
	});

	it("keeps reasoning.effort for an OpenAI id the catalog does not list", async () => {
		const { sent } = await wireRequest(
			"us.openai.gpt-7-preview",
			{ effort: "high" },
			"unlisted",
		);
		expect(sent).toEqual({ reasoning: { effort: "high" } });
	});
});
