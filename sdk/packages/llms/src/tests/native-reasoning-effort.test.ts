import type { ModelReasoningOption } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGateway } from "../providers/gateway";

// Exercise the real AI SDK adapters: portable max becomes xhigh, so the
// provider options must preserve max on the actual HTTP request.
describe("native reasoning effort wire contract", () => {
	it.each([
		{ providerId: "openai-native", modelId: "gpt-5.6", field: "reasoning" },
		{
			providerId: "anthropic",
			modelId: "claude-opus-4-7",
			field: "output_config",
		},
	])("sends advertised max effort on $providerId", async ({
		providerId,
		modelId,
		field,
	}) => {
		let body: Record<string, unknown> | undefined;
		const fetchStub = (async (_input, init) => {
			body = JSON.parse(String(init?.body));
			// Only the serialized request is under test; no credentials or live API.
			return new Response(
				JSON.stringify({
					error: { message: "stub", type: "invalid_request_error" },
				}),
				{
					status: 400,
					headers: { "content-type": "application/json" },
				},
			);
		}) as typeof fetch;
		const reasoningOptions: ModelReasoningOption[] = [
			{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
		];
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId,
					apiKey: "test-key",
					fetch: fetchStub,
					models: [
						{
							id: modelId,
							name: modelId,
							capabilities: ["text", "reasoning"],
							reasoningOptions,
						},
					],
				},
			],
		});
		for await (const _event of await gateway.stream({
			providerId,
			modelId,
			reasoning: { enabled: true, effort: "max" },
			maxTokens: 64,
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 0,
				},
			],
		})) {
			/* drain */
		}
		expect(body?.[field]).toMatchObject({ effort: "max" });
		if (providerId === "anthropic")
			expect(body?.thinking).toMatchObject({ type: "adaptive" });
	});
});
