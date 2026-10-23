// Wire-contract tests for reasoning effort on OpenAI-compatible providers,
// exercised through the *real* `@ai-sdk/openai-compatible` adapter. That
// adapter writes the AI SDK's top-level `reasoning` value to the request as
// `reasoning_effort` unchanged, so whatever level the gateway picks is exactly
// what the endpoint receives. Each case streams one turn through the gateway
// with a stubbed fetch and asserts on the request body. Together they pin:
//
//   1. a level the model does not advertise is snapped to the nearest level
//      it does advertise, so endpoints with a short ladder (Kimi K3 accepts
//      only low, high and max) are not sent values they reject;
//   2. the gateway never sends less effort than asked just because the
//      nearest advertised level cannot be expressed through the AI SDK's
//      portable reasoning setting;
//   3. models the catalog does not describe get the requested level as-is;
//   4. disabling reasoning sends `none`, since default-on reasoning models
//      otherwise keep thinking, except to models known not to reason and
//      models whose catalog advertises no off option.
import type {
	GatewayStreamRequest,
	ModelInfo,
	ModelReasoningOption,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../gateway";

const PROVIDER_ID = "nvidia";
const KIMI_K3_ID = "moonshotai/kimi-k3";
const KIMI_K3_EFFORTS: readonly ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "high", "max"] },
];

/**
 * Stream one turn and return the request body that reached the stubbed fetch.
 * The stub answers 400: only the request is under test. Passing
 * `reasoningOptions: undefined` leaves the model out of the provider config,
 * so the gateway resolves it as an unlisted id with no catalog facts.
 */
async function wireBody(input: {
	providerId?: string;
	modelId: string;
	reasoning: GatewayStreamRequest["reasoning"];
	reasoningOptions: readonly ModelReasoningOption[] | undefined;
	capabilities?: ModelInfo["capabilities"];
}): Promise<Record<string, unknown>> {
	const providerId = input.providerId ?? PROVIDER_ID;
	const configuredModel = input.reasoningOptions || input.capabilities;
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
				providerId,
				apiKey: "test-key",
				fetch: fetchStub,
				// A config model overrides a builtin of the same id, so these
				// definitions decide what the gateway sees regardless of the catalog.
				...(configuredModel
					? {
							models: [
								{
									id: input.modelId,
									name: input.modelId,
									capabilities: input.capabilities ?? ["text", "reasoning"],
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
	if (!configuredModel) {
		expect(
			gateway.listModels(providerId).map((model) => model.id),
		).not.toContain(input.modelId);
	}
	for await (const _event of await gateway.stream({
		providerId,
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

describe("OpenAI-compatible reasoning effort wire contract", () => {
	it.each([
		[{ effort: "minimal" }, "low"],
		[{ effort: "low" }, "low"],
		[{ effort: "medium" }, "high"],
		[{ effort: "high" }, "high"],
		[{ enabled: true }, "high"],
	] as const)("sends Kimi K3 an advertised level for %o", async (reasoning, expected) => {
		const body = await wireBody({
			modelId: KIMI_K3_ID,
			reasoning,
			reasoningOptions: KIMI_K3_EFFORTS,
		});
		expect(body.reasoning_effort).toBe(expected);
	});

	it.each([
		"xhigh",
		"max",
	] as const)("keeps %s at xhigh rather than lowering it to high", async (effort) => {
		// The nearest advertised level is max, which the AI SDK's portable
		// reasoning setting cannot carry yet; sending high instead would
		// silently cut the effort the user picked.
		const body = await wireBody({
			modelId: KIMI_K3_ID,
			reasoning: { effort },
			reasoningOptions: KIMI_K3_EFFORTS,
		});
		expect(body.reasoning_effort).toBe("xhigh");
	});

	it.each([
		"medium",
		"xhigh",
	] as const)("sends %s unchanged for a model the catalog does not list", async (effort) => {
		const body = await wireBody({
			modelId: "custom/kimi-k3-finetune",
			reasoning: { effort },
			reasoningOptions: undefined,
		});
		expect(body.reasoning_effort).toBe(effort);
	});
});

describe("OpenAI-compatible reasoning disable wire contract", () => {
	it("sends none for a model the catalog does not list", async () => {
		const body = await wireBody({
			modelId: "example/reasoning-model",
			reasoning: { enabled: false },
			reasoningOptions: undefined,
		});
		expect(body.reasoning_effort).toBe("none");
	});

	it("sends none for a model that advertises it", async () => {
		const body = await wireBody({
			modelId: "example/reasoning-model",
			reasoning: { enabled: false },
			reasoningOptions: [{ type: "effort", values: ["none", "low", "high"] }],
		});
		expect(body.reasoning_effort).toBe("none");
	});

	it("sends nothing to a model whose catalog has no off option", async () => {
		const body = await wireBody({
			modelId: KIMI_K3_ID,
			reasoning: { enabled: false },
			reasoningOptions: KIMI_K3_EFFORTS,
		});
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("sends nothing to a model known not to reason", async () => {
		const body = await wireBody({
			modelId: "example/non-reasoning-model",
			reasoning: { enabled: false },
			reasoningOptions: undefined,
			capabilities: ["text"],
		});
		expect(body).not.toHaveProperty("reasoning_effort");
	});
});
