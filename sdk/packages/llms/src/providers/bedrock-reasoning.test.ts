import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildAiSdkStreamConfig } from "./ai-sdk";
import { resolvePortableReasoning } from "./routing/portable-reasoning";
import { composeAiSdkProviderOptions } from "./routing/provider-options";
import { normalizeReasoningRequest } from "./routing/reasoning-options";

function context(
	modelId: string,
	model: Partial<GatewayProviderContext["model"]> = {},
): GatewayProviderContext {
	return {
		provider: {
			id: "bedrock",
			name: "Bedrock",
			defaultModelId: modelId,
			models: [],
		},
		model: {
			id: modelId,
			name: modelId,
			providerId: "bedrock",
			capabilities: ["reasoning"],
			reasoningOptions: [{ type: "effort", values: ["low", "medium", "high"] }],
			...model,
		},
		config: { providerId: "bedrock" },
	};
}

describe("Bedrock OpenAI reasoning request encoding", () => {
	it("preserves provider-default effort and supported disable semantics", () => {
		const modelId = "global.openai.gpt-6-astra";
		const resolved = context(modelId, {
			reasoningOptions: [
				{ type: "effort", values: ["none", "default", "high"] },
			],
		});
		const request: GatewayStreamRequest = {
			providerId: "bedrock",
			modelId,
			messages: [],
			reasoning: { enabled: true },
		};
		expect(composeAiSdkProviderOptions(request, resolved)).not.toHaveProperty(
			"bedrock.additionalModelRequestFields.reasoning_effort",
		);
		expect(
			composeAiSdkProviderOptions(
				{ ...request, reasoning: { enabled: false, effort: "high" } },
				resolved,
			),
		).toHaveProperty(
			"bedrock.additionalModelRequestFields.reasoning_effort",
			"none",
		);
	});

	it("supports unlisted OpenAI IDs without inferring an effort from a token budget", () => {
		const modelId = "global.openai.gpt-6-astra";
		const resolved = context(modelId, {
			capabilities: undefined,
			reasoningOptions: undefined,
		});
		const request: GatewayStreamRequest = {
			providerId: "bedrock",
			modelId,
			messages: [],
			reasoning: { enabled: true },
		};
		expect(composeAiSdkProviderOptions(request, resolved)).toHaveProperty(
			"bedrock.additionalModelRequestFields.reasoning_effort",
			"medium",
		);
		expect(
			composeAiSdkProviderOptions(
				{ ...request, reasoning: { enabled: true, budgetTokens: 2048 } },
				resolved,
			),
		).not.toHaveProperty(
			"bedrock.additionalModelRequestFields.reasoning_effort",
		);
	});
	it.each([
		"openai.gpt-6-astra",
		"global.openai.gpt-6-astra",
		"us.openai.gpt-6-astra",
		"eu.openai.gpt-6-astra",
		"openai.gpt-oss-120b-1:0",
	])("encodes %s without reasoningConfig for generation and streaming", async (modelId) => {
		for (const streaming of [false, true]) {
			let body: Record<string, unknown> | undefined;
			const provider = createAmazonBedrock({
				region: "us-east-1",
				apiKey: "test-only",
				fetch: async (_url, init) => {
					body = JSON.parse(String(init?.body));
					return streaming
						? new Response(new Uint8Array(), {
								headers: {
									"content-type": "application/vnd.amazon.eventstream",
								},
							})
						: new Response(
								JSON.stringify({
									output: {
										message: { role: "assistant", content: [{ text: "ok" }] },
									},
									stopReason: "end_turn",
									usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
									metrics: { latencyMs: 1 },
								}),
								{ headers: { "content-type": "application/json" } },
							);
				},
			});
			const request: GatewayStreamRequest = {
				providerId: "bedrock",
				modelId,
				messages: [],
				reasoning: { effort: "medium" },
				maxTokens: 100,
			};
			const resolved = context(modelId);
			const settings = buildAiSdkStreamConfig(request, resolved);
			const options = {
				...settings,
				prompt: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: "hi" }],
					},
				],
				providerOptions: composeAiSdkProviderOptions(
					request,
					resolved,
				) as never,
			};
			if (streaming) {
				const result = await provider(modelId).doStream(options);
				await result.stream.cancel();
			} else {
				await provider(modelId).doGenerate(options);
			}
			expect(body).toHaveProperty(
				"additionalModelRequestFields.reasoning_effort",
				"medium",
			);
			expect(body?.additionalModelRequestFields).not.toHaveProperty(
				"reasoningConfig",
			);
			expect(body).toHaveProperty("inferenceConfig.maxTokens", 100);
			expect(settings).not.toHaveProperty("reasoning");
		}
	});

	it.each([
		undefined,
		{},
		{ enabled: false },
		{ budgetTokens: 2048 },
	] as const)("does not invent an effort for %o", (reasoning) => {
		const modelId = "global.openai.gpt-6-astra";
		const request: GatewayStreamRequest = {
			providerId: "bedrock",
			modelId,
			messages: [],
			reasoning,
		};
		expect(
			composeAiSdkProviderOptions(request, context(modelId)),
		).not.toHaveProperty(
			"bedrock.additionalModelRequestFields.reasoning_effort",
		);
	});

	it("clamps enabled-only reasoning to the advertised effort", () => {
		for (const modelId of [
			"global.openai.gpt-6-astra",
			"amazon.nova-2-lite-v1:0",
		]) {
			const request: GatewayStreamRequest = {
				providerId: "bedrock",
				modelId,
				messages: [],
				reasoning: { enabled: true },
			};
			const resolved = context(modelId, {
				reasoningOptions: [{ type: "effort", values: ["high"] }],
			});
			if (modelId.startsWith("global.openai.")) {
				expect(composeAiSdkProviderOptions(request, resolved)).toHaveProperty(
					"bedrock.additionalModelRequestFields.reasoning_effort",
					"high",
				);
			} else {
				expect(resolvePortableReasoning(request, resolved)).toBe("high");
			}
		}
	});

	it.each([
		"anthropic.claude-sonnet-4-6",
		"custom-openai.model",
		"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example",
	])("does not reroute unrelated or opaque model %s", (modelId) => {
		const request: GatewayStreamRequest = {
			providerId: "bedrock",
			modelId,
			messages: [],
			reasoning: { effort: "high" },
		};
		expect(resolvePortableReasoning(request, context(modelId))).toBe("high");
		expect(
			composeAiSdkProviderOptions(request, context(modelId)),
		).not.toHaveProperty(
			"bedrock.additionalModelRequestFields.reasoning_effort",
		);
	});

	it("does not strip reasoning for other providers with incomplete capabilities", () => {
		const request: GatewayStreamRequest = {
			providerId: "custom-provider",
			modelId: "openai.gpt-6-astra",
			messages: [],
			reasoning: { effort: "high" },
		};
		const resolved = context(request.modelId, {
			capabilities: ["tools"],
			reasoningOptions: undefined,
		});
		expect(normalizeReasoningRequest(request, resolved).reasoning?.effort).toBe(
			"high",
		);
		expect(resolvePortableReasoning(request, resolved)).toBe("high");
	});
});
