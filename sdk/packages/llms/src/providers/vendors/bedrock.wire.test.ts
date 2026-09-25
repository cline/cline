// Wire-contract tests for Bedrock reasoning, exercised through the *real*
// `@ai-sdk/amazon-bedrock` adapter (bedrock.test.ts mocks the constructor).
// Each case streams one turn through the gateway with a stubbed fetch and
// asserts on the `additionalModelRequestFields` the adapter put on the
// Converse request. They pin the reason for the adapter floor of 5.0.65:
// OpenAI models reached through inference profiles (`us.openai.*`,
// `global.openai.*`) must get `reasoning.effort`, the field Bedrock accepts,
// not the generic `reasoningConfig` that older adapters emitted for any id
// they did not recognise (cline/cline#14451, vercel/ai#19403).
import type { GatewayStreamRequest, ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const EFFORT_OPTIONS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
];

interface WireRequest {
	/** Path of the Converse request, which carries the id the vendor resolved. */
	path: string | undefined;
	/** `additionalModelRequestFields` the adapter built; `null` when none. */
	sent: Record<string, unknown> | null | undefined;
}

/**
 * Stream one turn for `modelId` and return what reached the stubbed fetch.
 *
 * Registering the model on the provider config keeps model *selection* off
 * the generated catalog. Model-id *resolution* is not: the vendor still runs
 * every id through `resolveBedrockModelId`, which consults the catalog to
 * route bare profile-only ids (a bare `openai.gpt-…` in us-east-1 goes out as
 * `us.openai.gpt-…`). Ids that already carry a geo/global prefix pass
 * through untouched, so those cases pin the path as well. The stub answers
 * 400: only the request is under test.
 */
async function wireRequest(
	modelId: string,
	reasoning: GatewayStreamRequest["reasoning"],
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
				models: [
					{
						id: modelId,
						name: modelId,
						capabilities: ["text", "reasoning"],
						reasoningOptions: EFFORT_OPTIONS,
					},
				],
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
	return { path, sent };
}

describe("Bedrock reasoning wire contract", () => {
	// The regression: these ids reached the adapter with their prefix and got
	// the generic `reasoningConfig` before 5.0.65. They pass through the
	// resolver unchanged, so the path assertion needs no catalog.
	it.each([
		"us.openai.gpt-6-astra",
		"global.openai.gpt-5.6-luna",
	])("sends reasoning.effort for inference-profile OpenAI model %s", async (modelId) => {
		const { path, sent } = await wireRequest(modelId, { effort: "high" });
		expect(path).toBe(`/model/${modelId}/converse-stream`);
		expect(sent).toEqual({ reasoning: { effort: "high" } });
	});

	it("sends reasoning.effort for a bare OpenAI id, whichever profile the resolver picks", async () => {
		// In us-east-1 the resolver routes this bare id through a geo profile
		// when the catalog confirms one, so the adapter may see `us.openai.…`.
		// Either way the OpenAI shape must come out.
		const { path, sent } = await wireRequest("openai.gpt-6-astra", {
			effort: "high",
		});
		expect(path).toMatch(
			/\/model\/(?:[a-z-]+\.)?openai\.gpt-6-astra\/converse-stream$/,
		);
		expect(sent).toEqual({ reasoning: { effort: "high" } });
	});

	it("keeps reasoning_effort for gpt-oss", async () => {
		const { path, sent } = await wireRequest("openai.gpt-oss-120b-1:0", {
			effort: "high",
		});
		expect(path).toBe("/model/openai.gpt-oss-120b-1:0/converse-stream");
		expect(sent).toEqual({ reasoning_effort: "high" });
	});

	it("keeps Anthropic models on the adapter's native shape", async () => {
		const { path, sent } = await wireRequest("us.anthropic.claude-sonnet-4-6", {
			effort: "high",
		});
		expect(path).toBe("/model/us.anthropic.claude-sonnet-4-6/converse-stream");
		expect(sent).toMatchObject({ output_config: { effort: "high" } });
	});
});
