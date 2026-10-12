import type { AgentModelEvent, ModelInfo } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createAgentModelFromConfig } from "./handler-factory";
import { toProviderConfig } from "./provider-settings";

describe("core agent per-model protocol routing", () => {
	it.each([
		["muse-spark-1.3-contributor", "responses", "input"],
		["minimax-m2.7", "messages", "messages"],
		["qwen3.7-plus", "messages", "messages"],
		["glm-5.3", "chat/completions", "messages"],
	])("routes catalog model %s to %s without a provider-wide override", async (modelId, endpoint, inputField) => {
		const providerConfig = toProviderConfig({
			provider: "opencode-go",
			model: modelId,
			apiKey: "test-key",
		});
		expect(providerConfig.routingProviderId).toBeUndefined();
		await expectEndpoint(providerConfig, endpoint, inputField);
	});

	it.each<{
		protocol: NonNullable<ModelInfo["metadata"]>["apiProtocol"];
		endpoint: string;
		inputField: string;
	}>([
		{
			protocol: "openai-responses",
			endpoint: "responses",
			inputField: "input",
		},
		{ protocol: "anthropic", endpoint: "messages", inputField: "messages" },
		{
			protocol: "gemini",
			endpoint: "models/live-model:streamGenerateContent?alt=sse",
			inputField: "contents",
		},
		{
			protocol: "openai-chat",
			endpoint: "chat/completions",
			inputField: "messages",
		},
		{
			protocol: undefined,
			endpoint: "chat/completions",
			inputField: "messages",
		},
	])("routes a dynamically supplied $protocol model to $endpoint", async ({
		protocol,
		endpoint,
		inputField,
	}) => {
		await expectEndpoint(
			{
				...toProviderConfig({
					provider: "opencode-go",
					model: "live-model",
					apiKey: "test-key",
				}),
				knownModels: {
					"live-model": {
						id: "live-model",
						...(protocol ? { metadata: { apiProtocol: protocol } } : {}),
					},
				},
			},
			endpoint,
			inputField,
		);
	});
});

async function expectEndpoint(
	providerConfig: ReturnType<typeof toProviderConfig>,
	endpoint: string,
	inputField: string,
) {
	// Exercise the real gateway and HTTP serializers, but stop at the network
	// boundary. A non-retryable response keeps this test offline and deterministic.
	const fetchMock = vi.fn(
		async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
			Response.json(
				{ error: { message: "Routing test stopped at the network boundary" } },
				{ status: 400 },
			),
	);
	const model = createAgentModelFromConfig(
		{
			providerId: providerConfig.providerId,
			modelId: providerConfig.modelId,
			providerConfig: { ...providerConfig, fetch: fetchMock },
			systemPrompt: "",
			tools: [],
		},
		{ debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	);
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream({
		messages: [
			{
				id: "routing-test-message",
				createdAt: 0,
				role: "user",
				content: [{ type: "text", text: "Hello" }],
			},
		],
		tools: [],
	})) {
		events.push(event);
	}
	expect(events).toContainEqual(
		expect.objectContaining({ type: "finish", reason: "error" }),
	);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const [url, init] = fetchMock.mock.calls[0];
	expect(String(url)).toBe(`https://opencode.ai/zen/go/v1/${endpoint}`);
	const body = JSON.parse(String(init?.body));
	expect(body[inputField]).toBeDefined();
	if (inputField !== "contents") {
		expect(body.model).toBe(providerConfig.modelId);
	}
	if (inputField === "input") {
		expect(body.messages).toBeUndefined();
	}
}
