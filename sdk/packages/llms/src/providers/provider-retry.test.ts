import { APICallError } from "@ai-sdk/provider";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { PROVIDER_MAX_RETRIES } from "./ai-sdk";

function retryableError(): APICallError {
	return new APICallError({
		message: "temporarily rate limited",
		url: "https://provider.example/v1/chat/completions",
		requestBodyValues: {},
		statusCode: 429,
		responseHeaders: { "retry-after": "0" },
	});
}

function successfulStream() {
	return {
		stream: simulateReadableStream({
			chunks: [
				{ type: "text-start" as const, id: "text-1" },
				{
					type: "text-delta" as const,
					id: "text-1",
					delta: "recovered",
				},
				{ type: "text-end" as const, id: "text-1" },
				{
					type: "finish" as const,
					finishReason: { unified: "stop" as const, raw: undefined },
					usage: {
						inputTokens: {
							total: 1,
							noCache: 1,
							cacheRead: undefined,
							cacheWrite: undefined,
						},
						outputTokens: {
							total: 1,
							text: 1,
							reasoning: undefined,
						},
					},
				},
			],
			chunkDelayInMs: null,
			initialDelayInMs: null,
		}),
	};
}

async function drain(
	result: ReturnType<typeof streamText>,
): Promise<unknown[]> {
	const events: unknown[] = [];
	for await (const event of result.fullStream) {
		events.push(event);
	}
	return events;
}

describe("provider retry policy", () => {
	it("recovers from five consecutive retryable failures", async () => {
		let attempts = 0;
		const model = new MockLanguageModelV3({
			doStream: async () => {
				attempts += 1;
				if (attempts <= PROVIDER_MAX_RETRIES) {
					throw retryableError();
				}
				return successfulStream();
			},
		});

		const events = await drain(
			streamText({ model, prompt: "hello", maxRetries: PROVIDER_MAX_RETRIES }),
		);

		expect(attempts).toBe(PROVIDER_MAX_RETRIES + 1);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "recovered" }),
		);
		expect(events).not.toContainEqual(
			expect.objectContaining({ type: "error" }),
		);
	});

	it("stops after the bounded number of retryable attempts", async () => {
		let attempts = 0;
		const model = new MockLanguageModelV3({
			doStream: async () => {
				attempts += 1;
				throw retryableError();
			},
		});

		const events = await drain(
			streamText({ model, prompt: "hello", maxRetries: PROVIDER_MAX_RETRIES }),
		);

		expect(attempts).toBe(PROVIDER_MAX_RETRIES + 1);
		expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
	});

	it("does not retry a non-retryable client error", async () => {
		let attempts = 0;
		const model = new MockLanguageModelV3({
			doStream: async () => {
				attempts += 1;
				throw new APICallError({
					message: "invalid request",
					url: "https://provider.example/v1/chat/completions",
					requestBodyValues: {},
					statusCode: 400,
				});
			},
		});

		const events = await drain(
			streamText({ model, prompt: "hello", maxRetries: PROVIDER_MAX_RETRIES }),
		);

		expect(attempts).toBe(1);
		expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
	});

	it("stops retrying when the request is aborted", async () => {
		let attempts = 0;
		const abortController = new AbortController();
		const model = new MockLanguageModelV3({
			doStream: async () => {
				attempts += 1;
				abortController.abort(new Error("cancelled"));
				throw retryableError();
			},
		});

		await drain(
			streamText({
				model,
				prompt: "hello",
				maxRetries: PROVIDER_MAX_RETRIES,
				abortSignal: abortController.signal,
			}),
		);

		expect(attempts).toBe(1);
	});
});
