import { describe, expect, it } from "vitest";
import { emitAiSdkStream } from "./ai-sdk-stream";

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const chunks: T[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

describe("emitAiSdkStream", () => {
	it("forwards reasoning metadata from AI SDK reasoning chunks", async () => {
		const chunks = await collect(
			emitAiSdkStream(
				{
					fullStream: createAsyncIterable([
						{
							type: "reasoning-delta",
							delta: "Need weather data",
							providerMetadata: {
								anthropic: {
									signature: "sig-1",
									redactedData: "encrypted",
								},
								openrouter: {
									reasoning_details: [
										{
											type: "reasoning.text",
											text: "Need weather data",
											signature: "sig-1",
											format: "anthropic-claude-v1",
											index: 0,
										},
									],
								},
							},
						},
						{ type: "finish", usage: {} },
					]),
				},
				{
					responseId: "resp_1",
					errorMessage: "failed",
					calculateCost: () => undefined,
					reasoningTypes: ["reasoning-delta"],
				},
			),
		);

		expect(chunks).toContainEqual({
			type: "reasoning",
			reasoning: "Need weather data",
			signature: "sig-1",
			redacted_data: "encrypted",
			details: [
				{
					type: "reasoning.text",
					text: "Need weather data",
					signature: "sig-1",
					format: "anthropic-claude-v1",
					index: 0,
				},
			],
			id: "resp_1",
		});
	});
});
