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
});
