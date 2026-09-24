// Wire-contract tests for Bedrock reasoning, exercised through the *real*
// `@ai-sdk/amazon-bedrock` adapter (not the mocked constructor used by
// bedrock.test.ts). Each case streams one turn through the gateway with a
// stubbed fetch and asserts on the `additionalModelRequestFields` the adapter
// actually put on the Converse request. This pins the two facts the routing
// in `routing/bedrock-reasoning.ts` relies on (cline/cline#14095, #14451):
//
//   1. OpenAI models reached through inference profiles (`us.openai.*`,
//      `global.openai.*`) get `reasoning.effort`, the field Bedrock accepts —
//      not `reasoningConfig` (adapter < 5.0.65) and not `reasoning_effort`
//      (rejected too; gpt-oss is the one family that takes it);
//   2. unlisted ids such as application-inference-profile ARNs carry no
//      reasoning fields at all, so Bedrock cannot reject them.
import type { GatewayStreamRequest, ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const EFFORT_OPTIONS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

/**
 * What the model catalog says about the model under test. Every case states
 * this explicitly and registers the model on the provider config, so no
 * assertion here depends on the contents of the generated catalog (which is
 * regenerated as AWS adds and retires models).
 */
type CatalogFact =
	/** Listed, and advertises a user-facing effort control. */
	| "advertises-effort"
	/** Listed, but advertises no reasoning control. */
	| "no-controls"
	/** Not in the catalog at all, e.g. an inference-profile ARN. */
	| "unlisted";

/**
 * Stream one turn for `modelId` through the gateway and return the
 * `additionalModelRequestFields` of the Converse request the adapter built
 * (`null` when the request carried none). The stub answers 400 so no
 * credentials or network are involved; only the request is under test.
 */
async function sentAdditionalFields(
	modelId: string,
	reasoning: GatewayStreamRequest["reasoning"],
	catalog: CatalogFact = "advertises-effort",
): Promise<Record<string, unknown> | null | undefined> {
	let sent: Record<string, unknown> | null | undefined;
	const fetchStub = (async (_input, init) => {
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
				// definitions decide what the gate sees regardless of the catalog.
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
	return sent;
}

describe("Bedrock reasoning wire contract", () => {
	it.each([
		"openai.gpt-6-astra",
		"us.openai.gpt-6-astra",
		"global.openai.gpt-5.6-luna",
	])("sends reasoning.effort for OpenAI model %s", async (modelId) => {
		expect(await sentAdditionalFields(modelId, { effort: "high" })).toEqual({
			reasoning: { effort: "high" },
		});
	});

	it("keeps reasoning_effort for gpt-oss", async () => {
		expect(
			await sentAdditionalFields("openai.gpt-oss-120b-1:0", { effort: "high" }),
		).toEqual({ reasoning_effort: "high" });
	});

	it("sends no reasoning fields for an unlisted inference-profile ARN", async () => {
		expect(
			await sentAdditionalFields(
				"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123",
				{ effort: "medium" },
				"unlisted",
			),
		).toBeNull();
	});

	it("sends no reasoning fields for a catalog model without reasoning controls", async () => {
		expect(
			await sentAdditionalFields(
				"us.amazon.nova-micro-v1:0",
				{ effort: "high" },
				"no-controls",
			),
		).toBeNull();
	});

	it("keeps reasoningConfig for a catalog model that advertises reasoning", async () => {
		// Nova takes Bedrock's own `reasoningConfig`; the adapter's generic
		// branch is right for it, so the catalog gate must let it through.
		expect(
			await sentAdditionalFields("us.amazon.nova-2-lite-v1:0", {
				effort: "high",
			}),
		).toMatchObject({ reasoningConfig: expect.anything() });
	});

	it("keeps Anthropic models on the adapter's native shape", async () => {
		expect(
			await sentAdditionalFields("us.anthropic.claude-sonnet-4-6", {
				effort: "high",
			}),
		).toMatchObject({ output_config: { effort: "high" } });
	});
});
