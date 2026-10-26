import {
	APICallError,
	RetryError,
	StreamProviderError,
	ToolChoiceViolationError,
} from "ai";
import { describe, expect, it } from "vitest";
import { createStreamRetryBackoff } from "./stream-retry-backoff";

const overloaded = () =>
	new StreamProviderError({
		message: "Our servers are currently overloaded. Please try again later.",
		code: "server_is_overloaded",
	});

const apiCallError = (statusCode: number, message = "error") =>
	new APICallError({
		message,
		url: "https://api.example.com/v1/chat/completions",
		requestBodyValues: {},
		statusCode,
	});

describe("createStreamRetryBackoff", () => {
	it("doubles the wait per re-dial up to the cap", () => {
		const backoff = createStreamRetryBackoff(5, {
			baseDelayMs: 1000,
			maxDelayMs: 3000,
		});
		expect([1, 2, 3, 4].map(() => backoff.onError(overloaded()))).toEqual([
			{ attempt: 1, delayMs: 1000 },
			{ attempt: 2, delayMs: 2000 },
			{ attempt: 3, delayMs: 3000 },
			{ attempt: 4, delayMs: 3000 },
		]);
	});

	it("stops once the SDK's retry budget is spent and starts over per step", () => {
		const backoff = createStreamRetryBackoff(2);
		expect(backoff.onError(overloaded())).toMatchObject({ attempt: 1 });
		expect(backoff.onError(overloaded())).toMatchObject({ attempt: 2 });
		expect(backoff.onError(overloaded())).toBeUndefined();
		backoff.startStep();
		expect(backoff.onError(overloaded())).toMatchObject({ attempt: 1 });
	});

	it("waits for in-band provider errors the SDK will retry", () => {
		const backoff = createStreamRetryBackoff(3);
		expect(
			backoff.onError({
				error: { message: "Service temporarily overloaded", code: 503 },
			}),
		).toBeDefined();
		expect(backoff.onError(new Error("Stream error occurred"))).toBeDefined();
		expect(backoff.onError(apiCallError(503))).toBeDefined();
	});

	it("does not wait for errors no stream retry follows", () => {
		const backoff = createStreamRetryBackoff(3);
		const exhausted = new RetryError({
			message: "Failed after 4 attempts",
			reason: "maxRetriesExceeded",
			errors: [apiCallError(503)],
		});
		const toolChoice = new ToolChoiceViolationError({
			toolChoice: { type: "required" },
			finishReason: "stop",
			provider: "test",
			modelId: "test-model",
			content: [],
		});
		const socketClosed = Object.assign(new Error("terminated"), {
			cause: Object.assign(new Error("other side closed"), {
				code: "UND_ERR_SOCKET",
			}),
		});
		expect(backoff.onError(exhausted)).toBeUndefined();
		expect(backoff.onError(toolChoice)).toBeUndefined();
		expect(backoff.onError(socketClosed)).toBeUndefined();
	});

	it("does not wait for failures that reproduce on every attempt", () => {
		const backoff = createStreamRetryBackoff(3);
		expect(
			backoff.onError(apiCallError(401, "Invalid API key")),
		).toBeUndefined();
		expect(
			backoff.onError(
				apiCallError(400, "This model's maximum context length is 8192 tokens"),
			),
		).toBeUndefined();
	});

	it("sums the re-dials and waits for the terminal failure", () => {
		const backoff = createStreamRetryBackoff(3, { baseDelayMs: 100 });
		backoff.onError(overloaded());
		backoff.onError(overloaded());
		expect(backoff.summary()).toEqual({
			streamRetryAttempts: 2,
			streamRetryWaitMs: 300,
		});
	});
});
