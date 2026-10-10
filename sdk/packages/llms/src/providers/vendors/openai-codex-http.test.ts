import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { GatewayProviderContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createOpenAIProviderModule } from "./openai";

// The subscription manifest uses family "openai" (Responses HTTP), not
// family "openai-codex" (the separate local Codex CLI subprocess provider).
describe("Codex subscription HTTP serialization", () => {
	it.each([
		"priority",
		undefined,
	] as const)("serializes tier %s at the fetch boundary", async (serviceTier) => {
		let body: Record<string, unknown> | undefined;
		const config = {
			providerId: "openai-codex",
			apiKey: "test-token",
			baseUrl: "https://chatgpt.com/backend-api/codex",
			fetch: (async (_url, init) => {
				body = JSON.parse(String(init?.body));
				return new Response("data: [DONE]\n\n", {
					headers: { "content-type": "text/event-stream" },
				});
			}) as typeof fetch,
		};
		const context = {
			provider: {
				id: "openai-codex",
				name: "Codex",
				defaultModelId: "gpt-6-astra",
				models: [],
			},
			model: {
				providerId: "openai-codex",
				id: "gpt-6-astra",
				name: "GPT-6 Astra",
			},
			config,
		} as GatewayProviderContext;
		const provider = await createOpenAIProviderModule(config, context);
		const model = provider.operations.language(
			"gpt-6-astra",
		) as LanguageModelV4;
		await model.doStream({
			prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
			providerOptions: {
				openai: { store: false, ...(serviceTier ? { serviceTier } : {}) },
			},
		});
		expect(body?.model).toBe("gpt-6-astra");
		if (serviceTier) expect(body?.service_tier).toBe("priority");
		else expect(body).not.toHaveProperty("service_tier");
		expect(body).not.toHaveProperty("serviceTier");
		expect(body?.service_tier).not.toBe("fast");
	});
});
