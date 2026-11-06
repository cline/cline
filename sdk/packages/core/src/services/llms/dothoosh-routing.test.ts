import type { AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { mapDotHooshModels } from "./dothoosh-models";
import { createAgentModelFromConfig } from "./handler-factory";
import { toProviderConfig } from "./provider-settings";

// Shapes copied from the live GET /v1/models listing.
const LIVE_LISTING = {
	object: "list",
	data: [
		{
			id: "deepseek-flash",
			status: "active",
			protocols: [
				{ protocol: "anthropic-messages" },
				{ protocol: "openai-chat-completions" },
			],
			context_length: 1_048_576,
			supported_parameters: ["max_tokens", "reasoning", "tools"],
		},
		{
			id: "gpt-6-luna",
			status: "active",
			protocols: [
				{ protocol: "openai-chat-completions" },
				{ protocol: "openai-responses" },
			],
			context_length: 1_050_000,
			supported_parameters: ["max_tokens", "reasoning", "tools"],
		},
	],
};

describe("DotHoosh per-model protocol routing", () => {
	it.each([
		["gpt-6-luna", "responses", "input"],
		["deepseek-flash", "chat/completions", "messages"],
	])("sends %s to /%s", async (modelId, endpoint, inputField) => {
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
				Response.json(
					{ error: { message: "stopped at the network boundary" } },
					{ status: 400 },
				),
		);
		const providerConfig = {
			...toProviderConfig({
				provider: "dothoosh",
				model: modelId,
				apiKey: "test-key",
			}),
			knownModels: mapDotHooshModels(LIVE_LISTING),
		};
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
					id: "m1",
					createdAt: 0,
					role: "user",
					content: [{ type: "text", text: "Hello" }],
				},
			],
			tools: [],
		})) {
			events.push(event);
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toBe(`https://gateway.dothoosh.com/v1/${endpoint}`);
		expect(JSON.parse(String(init?.body))[inputField]).toBeDefined();
	});
});
