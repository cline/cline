import { createHandlerAsync, type Message } from "@cline/llms";
import { describe, expect, it } from "vitest";
import { safeParseSettings, toProviderConfig } from "./provider-settings";

function openAiTextStream(text: string): string {
	const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
		`data: ${JSON.stringify({
			id: "chatcmpl-xai-test",
			object: "chat.completion.chunk",
			created: 1,
			model: "grok-build-0.1",
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		})}\n\n`;

	return (
		chunk({ role: "assistant", content: text }, null) +
		chunk({}, "stop") +
		"data: [DONE]\n\n"
	);
}

describe("provider settings", () => {
	it("formats Cline OAuth access tokens for runtime API keys", () => {
		const config = toProviderConfig({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			auth: {
				accessToken: "oauth-access-token",
			},
		});

		expect(config.apiKey).toBe("workos:oauth-access-token");
		expect(config.accessToken).toBe("oauth-access-token");
	});

	it("routes xAI subscription OAuth through the Grok Build API provider", () => {
		const config = toProviderConfig({
			provider: "xai-subscription",
			auth: {
				accessToken: "xai-oauth-access-token",
			},
		});

		expect(config).toMatchObject({
			providerId: "xai-subscription",
			apiKey: "xai-oauth-access-token",
			accessToken: "xai-oauth-access-token",
			baseUrl: "https://api.x.ai/v1",
			modelId: "grok-build-0.1",
		});
	});

	it("sends a persisted xAI subscription token as the Grok Build bearer credential", async () => {
		let outboundRequest:
			| {
					url: string;
					authorization: string | null;
					body: unknown;
			  }
			| undefined;
		const fetchMock = async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			const request = new Request(input, init);
			outboundRequest = {
				url: request.url,
				authorization: request.headers.get("authorization"),
				body: await request.clone().json(),
			};
			return new Response(openAiTextStream("hello from Grok"), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		};
		const config = {
			...toProviderConfig({
				provider: "xai-subscription",
				auth: { accessToken: "xai-oauth-access-token" },
			}),
			fetch: fetchMock as typeof fetch,
		};
		const handler = await createHandlerAsync(config);
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "say hello" }],
			},
		];

		for await (const _chunk of handler.createMessage("Be concise.", messages)) {
			// Consume the response so the adapter issues and completes the request.
		}

		expect(outboundRequest).toMatchObject({
			url: "https://api.x.ai/v1/chat/completions",
			authorization: "Bearer xai-oauth-access-token",
			body: {
				model: "grok-build-0.1",
				stream: true,
			},
		});
	});

	it("accepts the Bedrock apikey authentication alias", () => {
		const result = safeParseSettings({
			provider: "bedrock",
			model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			aws: {
				authentication: "apikey",
				region: "us-east-1",
			},
		});

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error("expected Bedrock apikey settings to parse");
		}

		expect(toProviderConfig(result.data).aws).toEqual(
			expect.objectContaining({
				authentication: "apikey",
			}),
		);
	});
});
