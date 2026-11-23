import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "./gateway";

const messages: AgentMessage[] = [
	{
		id: "user_1",
		role: "user",
		content: [{ type: "text", text: "Generate a small test image" }],
		createdAt: Date.now(),
	},
];

async function collect(
	iterable: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

describe("OpenRouter image transport", () => {
	it("decodes generated image responses into gateway image events", async () => {
		let requestBody: Record<string, unknown> | undefined;
		const imageBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				requestBody =
					typeof init?.body === "string"
						? (JSON.parse(init.body) as Record<string, unknown>)
						: undefined;
				return Response.json(
					{
						success: true,
						data: {
							created: 1,
							data: [{ b64_json: imageBase64 }],
							usage: {
								prompt_tokens: 1,
								completion_tokens: 1,
								total_tokens: 2,
							},
						},
					},
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			},
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "test",
					fetch: fetchMock as typeof fetch,
					models: [
						{
							id: "google/gemini-image-test",
							name: "Gemini Image Test",
							operation: "image-generation",
							modalities: {
								input: ["text", "image"],
								output: ["image"],
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "google/gemini-image-test",
				messages,
			}),
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://api.cline.bot/api/v1/images",
		);
		expect(requestBody).toMatchObject({
			model: "google/gemini-image-test",
			modalities: ["image", "text"],
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "media",
				media: expect.objectContaining({
					id: expect.any(String),
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: imageBase64 },
				}),
			}),
		);
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
	});

	it("does not buffer mixed-image chat streams while unwrapping image responses", async () => {
		const modelId = "google/gemini-mixed-image-test";
		const sse = [
			`data: ${JSON.stringify({
				id: "chatcmpl-test",
				created: 0,
				model: modelId,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "Streamed response" },
						finish_reason: null,
					},
				],
			})}`,
			`data: ${JSON.stringify({
				id: "chatcmpl-test",
				created: 0,
				model: modelId,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 1,
					completion_tokens: 1,
					total_tokens: 2,
				},
			})}`,
			"data: [DONE]",
			"",
		].join("\n\n");
		const response = new Response(sse, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
		const responseTextSpy = vi.spyOn(response, "text");
		const fetchMock = vi.fn(async () => response);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "test",
					fetch: fetchMock as typeof fetch,
					models: [
						{
							id: modelId,
							name: "Gemini Mixed Image Test",
							modalities: {
								input: ["text", "image"],
								output: ["text", "image"],
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId,
				messages,
			}),
		);

		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://api.cline.bot/api/v1/chat/completions",
		);
		expect(responseTextSpy).not.toHaveBeenCalled();
		expect(events).toContainEqual({
			type: "text-delta",
			text: "Streamed response",
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
	});
});
