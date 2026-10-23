import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	MINIMAX_EFFORTS,
	MINIMAX_PROVIDER_IDS,
} from "../../catalog/catalog-minimax";
import { MINIMAX_THINKING_ROUTING_METADATA } from "../routing/minimax-thinking";
import { resolvePortableReasoning } from "../routing/portable-reasoning";
import { composeAiSdkProviderOptions } from "../routing/provider-options";
import { createAnthropicProviderModule } from "./anthropic";
import { createMiniMaxThinkingFetch } from "./minimax-thinking";

async function requestBody(
	providerId: string,
	modelId: string,
	reasoning?: GatewayStreamRequest["reasoning"],
) {
	const captured: Record<string, unknown>[] = [];
	const mockFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
		expect(String(input)).toBe("https://api.minimax.io/anthropic/v1/messages");
		captured.push(JSON.parse(String(init?.body)));
		return Response.json({
			id: "msg_test",
			type: "message",
			role: "assistant",
			model: modelId,
			content: [{ type: "text", text: "Hello" }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		});
	});
	const context: GatewayProviderContext = {
		provider: {
			id: providerId,
			name: providerId,
			models: [],
			metadata: MINIMAX_THINKING_ROUTING_METADATA,
		},
		model: {
			id: modelId,
			name: modelId,
			providerId,
			capabilities: ["reasoning"],
		},
		config: {
			providerId,
			apiKey: "test-key",
			baseUrl: "https://api.minimax.io/anthropic/v1",
			fetch: mockFetch as typeof fetch,
		},
	};
	const request: GatewayStreamRequest = {
		providerId,
		modelId,
		messages: [],
		reasoning,
	};
	const providerOptions = composeAiSdkProviderOptions(
		request,
		context,
		"anthropic",
	);
	expect(
		resolvePortableReasoning(request, { context, adapter: "anthropic" }),
	).toBeUndefined();
	const module = await createAnthropicProviderModule(context.config, context);
	await module.operations.language(modelId).doGenerate({
		prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
		maxOutputTokens: 524_288,
		providerOptions: providerOptions as never,
	});
	return captured[0];
}

describe("MiniMax Messages wire contract", () => {
	it.each(
		MINIMAX_PROVIDER_IDS,
	)("preserves all Flash efforts for %s", async (providerId) => {
		for (const effort of MINIMAX_EFFORTS) {
			const body = await requestBody(providerId, "MiniMax-M3.1-Flash", {
				effort,
			});
			expect(body.thinking).toEqual({ type: "adaptive" });
			expect(body.output_config).toEqual({ effort });
			expect(body.max_tokens).toBe(524_288);
			expect(body).not.toHaveProperty("service_tier");
		}
	});

	it.each([
		undefined,
		{ enabled: true },
		{ enabled: false },
		{ budgetTokens: 8192 },
	])("defaults Flash to adaptive/max for %j", async (reasoning) => {
		const body = await requestBody("minimax", "MiniMax-M3.1-Flash", reasoning);
		expect(body.thinking).toEqual({ type: "adaptive" });
		expect(body.output_config).toEqual({ effort: "max" });
	});

	it.each([
		true,
		false,
	])("preserves M3 toggle %s and ignores effort", async (enabled) => {
		const body = await requestBody("minimax", "MiniMax-M3", {
			enabled,
			effort: "max",
		});
		expect(body.thinking).toEqual({ type: enabled ? "adaptive" : "disabled" });
		expect(body).not.toHaveProperty("output_config");
	});

	it("does not enable M3 thinking for an effort-only request", async () => {
		const body = await requestBody("minimax", "MiniMax-M3", { effort: "high" });
		expect(body).not.toHaveProperty("thinking");
		expect(body).not.toHaveProperty("output_config");
	});

	it.each([
		"MiniMax-M3",
		"MiniMax-M3.1-Flash",
	])("validates documented max_tokens boundaries for %s", async (model) => {
		const baseFetch = vi.fn(async () => new Response("{}"));
		const fetcher = createMiniMaxThinkingFetch(baseFetch as typeof fetch);
		for (const max_tokens of [1, 524_288]) {
			await fetcher("https://api.minimax.io/anthropic/v1/messages", {
				body: JSON.stringify({ model, max_tokens }),
			});
		}
		for (const max_tokens of [0, 524_289, 1.5]) {
			await expect(
				fetcher("https://api.minimax.io/anthropic/v1/messages", {
					body: JSON.stringify({ model, max_tokens }),
				}),
			).rejects.toThrow("max_tokens");
		}
		expect(baseFetch).toHaveBeenCalledTimes(2);
	});

	it("strips unsupported Flash overrides and preserves custom model payloads", async () => {
		const baseFetch = vi.fn(
			async (_input: unknown, _init?: RequestInit) => new Response("{}"),
		);
		const fetcher = createMiniMaxThinkingFetch(baseFetch as typeof fetch);
		await fetcher("https://api.minimax.io/anthropic/v1/messages", {
			body: JSON.stringify({
				model: "MiniMax-M3.1-Flash",
				service_tier: "priority",
				thinking: { type: "disabled" },
				output_config: { effort: "none" },
			}),
		});
		expect(JSON.parse(String(baseFetch.mock.calls[0][1]?.body))).toEqual({
			model: "MiniMax-M3.1-Flash",
			thinking: { type: "adaptive" },
			output_config: { effort: "max" },
		});
		const customBody = JSON.stringify({
			model: "custom-model",
			max_tokens: 600_000,
			thinking: { type: "disabled" },
		});
		await fetcher("https://api.minimax.io/anthropic/v1/messages", {
			body: customBody,
		});
		expect(baseFetch.mock.calls[1][1]?.body).toBe(customBody);
	});
});
