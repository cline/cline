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
	it("decodes generated message images into gateway image events", async () => {
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
							id: "gen_1",
							model: "google/gemini-image-test",
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: null,
										images: [
											{
												type: "image_url",
												image_url: {
													url: `data:image/png;base64,${imageBase64}`,
												},
											},
										],
									},
									finish_reason: "stop",
								},
							],
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
				modelId: "google/gemini-image-test",
				messages,
			}),
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://api.cline.bot/api/v1/chat/completions",
		);
		expect(requestBody).toMatchObject({
			model: "google/gemini-image-test",
			modalities: ["image", "text"],
		});
		expect(events).toContainEqual({
			type: "image",
			data: imageBase64,
			mediaType: "image/png",
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
	});
});
