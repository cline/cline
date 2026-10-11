import { describe, expect, it, vi } from "vitest";
import { createHandlerAsync } from "../providers";

// Exercise the real handler, option composer, and AI SDK serializer. Only
// the HTTP boundary is mocked, so a dropped option fails these assertions.
describe("provider fallback HTTP requests", () => {
	it.each([
		"openrouter",
		"cline",
		"cline-pass",
	])("sends provider failover for Anthropic models through %s", async (providerId) => {
		for (const modelId of ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"]) {
			const providerFetch = vi.fn<typeof fetch>(
				async () =>
					new Response(
						`data: ${JSON.stringify({
							id: "test",
							object: "chat.completion.chunk",
							created: 0,
							model: modelId,
							choices: [
								{ index: 0, delta: { content: "OK" }, finish_reason: "stop" },
							],
						})}\n\ndata: [DONE]\n\n`,
						{ headers: { "content-type": "text/event-stream" } },
					),
			);
			const handler = await createHandlerAsync({
				providerId,
				modelId,
				apiKey: "test-key",
				fetch: providerFetch,
			});
			let doneSeen = false;
			for await (const chunk of handler.createMessage("Be concise.", [
				{ role: "user", content: "Say OK." },
			])) {
				if (chunk.type === "done") {
					expect(chunk.success).toBe(true);
					doneSeen = true;
				}
			}
			expect(doneSeen).toBe(true);
			expect(providerFetch).toHaveBeenCalledTimes(1);
			const call = providerFetch.mock.calls[0];
			if (!call) throw new Error("Expected an HTTP request");
			const [url, init] = call;
			expect(String(url)).toContain("/chat/completions");
			const body = JSON.parse(String(init?.body));
			expect(body.model).toBe(modelId);
			if (modelId.startsWith("anthropic/")) {
				expect(body.provider).toEqual({ allow_fallbacks: true });
			} else {
				expect(body.provider).toBeUndefined();
			}
			expect(body).not.toHaveProperty("fallbacks");
		}
	});

	function anthropicStream(): Response {
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg-1",
					type: "message",
					role: "assistant",
					model: "claude-sonnet-4-6",
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			},
			{
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "OK" },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: { output_tokens: 1 },
			},
			{ type: "message_stop" },
		];
		return new Response(
			events
				.map(
					(event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
				)
				.join(""),
			{ headers: { "content-type": "text/event-stream" } },
		);
	}

	it.each([
		{ baseUrl: undefined, official: true },
		{ baseUrl: "https://api.anthropic.com/v1", official: true },
		{
			baseUrl: "https://example.services.ai.azure.com/anthropic/v1",
			official: false,
		},
	])("sends Anthropic refusal fallback only to the Claude API ($baseUrl)", async ({
		baseUrl,
		official,
	}) => {
		const providerFetch = vi.fn<typeof fetch>(async () => anthropicStream());
		const handler = await createHandlerAsync({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test-key",
			baseUrl,
			fetch: providerFetch,
		});
		let doneSeen = false;
		for await (const chunk of handler.createMessage("Be concise.", [
			{ role: "user", content: "Say OK." },
		])) {
			if (chunk.type === "done") {
				expect(chunk.success).toBe(true);
				doneSeen = true;
			}
		}
		expect(doneSeen).toBe(true);
		expect(providerFetch).toHaveBeenCalledTimes(1);
		const call = providerFetch.mock.calls[0];
		if (!call) throw new Error("Expected an HTTP request");
		const [url, init] = call;
		expect(String(url)).toBe(
			`${baseUrl ?? "https://api.anthropic.com/v1"}/messages`,
		);
		const body = JSON.parse(String(init?.body));
		const betas = new Headers(init?.headers).get("anthropic-beta") ?? "";
		if (official) {
			expect(body.fallbacks).toBe("default");
			expect(betas).toContain("server-side-fallback-2026-07-01");
		} else {
			expect(body).not.toHaveProperty("fallbacks");
			expect(betas).not.toContain("server-side-fallback");
		}
	});
});
