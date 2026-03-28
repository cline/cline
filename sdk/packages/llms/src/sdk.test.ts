import { describe, expect, it } from "vitest";
import type { ModelInfo } from "./models";
import { BUILT_IN_PROVIDER } from "./providers/config/provider-ids";
import { OpenAIBaseHandler } from "./providers/handlers/openai-base";
import { OpenAIResponsesHandler } from "./providers/handlers/openai-responses";
import { createLlmsSdk } from "./sdk";

const TEST_MODEL: ModelInfo = {
	id: "acme-chat-1",
	name: "Acme Chat 1",
	capabilities: ["tools", "streaming"],
};

describe("llms runtime registry", () => {
	it("lists built-in provider metadata", async () => {
		const sdk = createLlmsSdk({
			providers: [{ id: "anthropic", models: ["claude-sonnet-4-6"] }],
		});

		const builtins = await sdk.getBuiltInProviders();

		expect(builtins.length).toBeGreaterThan(0);
		expect(builtins.some((provider) => provider.id === "anthropic")).toBe(true);
		expect(builtins.some((provider) => provider.id === "openai-native")).toBe(
			true,
		);
	});

	it("routes a configured custom provider through a built-in provider family", () => {
		const sdk = createLlmsSdk({
			providers: [
				{
					id: "acme-openrouter",
					builtinProviderId: BUILT_IN_PROVIDER.OPENROUTER,
					baseUrl: "https://router.acme.test/v1",
					models: ["acme-chat-1"],
				},
			],
		});

		const handler = sdk.createHandler({ providerId: "acme-openrouter" });

		expect(handler).toBeInstanceOf(OpenAIBaseHandler);
		expect(sdk.isProviderConfigured("acme-openrouter")).toBe(true);
		expect(sdk.isModelConfigured("acme-openrouter", "acme-chat-1")).toBe(true);
	});

	it("registers a custom provider catalog that reuses a built-in provider handler", () => {
		const sdk = createLlmsSdk({
			providers: [{ id: "anthropic", models: ["claude-sonnet-4-6"] }],
		});

		sdk.registerBuiltinProvider({
			id: "acme-openai",
			builtinProviderId: BUILT_IN_PROVIDER.OPENAI_NATIVE,
			name: "Acme OpenAI",
			baseUrl: "https://api.acme.test/v1",
			models: {
				[TEST_MODEL.id]: TEST_MODEL,
			},
		});

		const handler = sdk.createHandler({ providerId: "acme-openai" });

		expect(handler).toBeInstanceOf(OpenAIResponsesHandler);
		expect(sdk.getModels("acme-openai")).toEqual([TEST_MODEL.id]);
		expect(
			sdk.getProviders().find((provider) => provider.id === "acme-openai"),
		).toEqual({
			id: "acme-openai",
			models: [TEST_MODEL.id],
			defaultModel: TEST_MODEL.id,
		});
	});
});
