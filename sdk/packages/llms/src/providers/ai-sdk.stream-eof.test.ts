import type { AgentModelEvent, GatewayStreamRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createGatewayApiHandler } from "./compat";
import { createGateway } from "./gateway";
import type { ApiStreamChunk } from "./stream";

/**
 * Drives the real `ai` package and OpenAI-compatible provider with an SSE body
 * that stops after a partial delta: no `finish_reason`, no `[DONE]`. The
 * provider reports this as an error part rather than a finish reason.
 */

const EOF_MESSAGE = "Response stream ended without a finish reason.";

const eofSse = `data: ${JSON.stringify({
	id: "cmpl-1",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [
		{
			index: 0,
			delta: { role: "assistant", content: "I'll start by" },
			finish_reason: null,
		},
	],
})}\n\n`;

const providerConfig = {
	providerId: "openai-compatible",
	apiKey: "test-key",
	baseUrl: "http://fake.local/v1",
	fetch: (async () =>
		new Response(eofSse, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		})) as unknown as typeof fetch,
};

describe("OpenAI-compatible stream that ends without a finish reason", () => {
	it("reaches the agent as an unknown finish with the partial text", async () => {
		const gateway = createGateway({ providerConfigs: [providerConfig] });
		const events: AgentModelEvent[] = [];
		for await (const event of await gateway.stream({
			providerId: "openai-compatible",
			modelId: "test-model",
			messages: [
				{
					id: "msg_user",
					role: "user",
					content: [{ type: "text", text: "Hi" }],
					createdAt: Date.now(),
				},
			],
		} as unknown as GatewayStreamRequest)) {
			events.push(event);
		}

		expect(events).toContainEqual({
			type: "text-delta",
			text: "I'll start by",
		});
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "unknown",
			error: EOF_MESSAGE,
		});
	});

	it("still fails through the ApiHandler boundary", async () => {
		const handler = createGatewayApiHandler({
			...providerConfig,
			modelId: "test-model",
		});
		const chunks: ApiStreamChunk[] = [];
		for await (const chunk of handler.createMessage("", [
			{ role: "user", content: "Hi" },
		])) {
			chunks.push(chunk);
		}

		expect(chunks.at(-1)).toMatchObject({
			type: "done",
			success: false,
			error: EOF_MESSAGE,
		});
	});
});
