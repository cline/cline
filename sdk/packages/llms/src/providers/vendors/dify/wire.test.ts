// Wire test for the vendored Dify provider, exercised the way the gateway uses
// it: through `createDifyProviderModule` and the AI SDK's `streamText`, which
// adapts the provider's v2 model to the current model interface. A stubbed
// fetch records the outgoing request and returns a canned Dify SSE stream.
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { streamText } from "ai";
import { describe, expect, it } from "vitest";
import { createDifyProviderModule } from "../community";

describe("dify provider through createDifyProviderModule", () => {
	it("streams a chat-messages reply through streamText", async () => {
		const events = [
			{ event: "message", answer: "Hel", id: "m1", conversation_id: "c1" },
			{ event: "message", answer: "lo", id: "m1", conversation_id: "c1" },
			{
				event: "message_end",
				id: "m1",
				conversation_id: "c1",
				metadata: {
					usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
				},
			},
		];
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchStub = (async (input, init) => {
			requests.push({ url: String(input), init });
			return new Response(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
				{ headers: { "content-type": "text/event-stream" } },
			);
		}) as typeof fetch;

		const module = await createDifyProviderModule({
			providerId: "dify",
			apiKey: "test-key",
			baseUrl: "https://dify.example/v1",
			fetch: fetchStub,
		} as GatewayResolvedProviderConfig);
		const result = streamText({
			model: module.operations.language("dify-app") as Parameters<
				typeof streamText
			>[0]["model"],
			prompt: "Say hello.",
		});

		expect(await result.text).toBe("Hello");
		expect((await result.totalUsage).outputTokens).toBe(2);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://dify.example/v1/chat-messages");
		const headers = new Headers(requests[0]?.init?.headers);
		expect(headers.get("authorization")).toBe("Bearer test-key");
		const body = JSON.parse(String(requests[0]?.init?.body));
		expect(body.response_mode).toBe("streaming");
		expect(body.query).toContain("Say hello.");
	});
});
