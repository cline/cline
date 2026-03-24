import { describe, expect, it, vi } from "vitest";
import type { ApiStream, ProviderConfig } from "../types/index";
import { BaseHandler } from "./base";

class TestHandler extends BaseHandler {
	getMessages(): unknown {
		return [];
	}

	createMessage(): ApiStream {
		throw new Error("not implemented");
	}

	public computeCost(
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens = 0,
		cacheWriteTokens = 0,
	): number | undefined {
		return this.calculateCost(
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
		);
	}

	public computeCostFromInclusiveInput(
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens = 0,
		cacheWriteTokens = 0,
	): number | undefined {
		return this.calculateCostFromInclusiveInput(
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
		);
	}

	public exposeAbortSignal(): AbortSignal {
		return this.getAbortSignal();
	}

	public normalizeBadRequest(error: unknown): Error | undefined {
		return this.normalizeOpenAICompatibleBadRequest(error);
	}
}

describe("BaseHandler.calculateCost", () => {
	it("uses known model pricing when modelInfo is not provided", () => {
		const config: ProviderConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-test",
			apiKey: "test-key",
			knownModels: {
				"claude-sonnet-test": {
					id: "claude-sonnet-test",
					pricing: {
						input: 3,
						output: 15,
						cacheRead: 0.3,
					},
				},
			},
		};
		const handler = new TestHandler(config);

		const cost = handler.computeCost(1_000_000, 1_000_000, 100_000);

		expect(cost).toBeCloseTo(18.03, 6);
	});

	it("does not charge cache reads twice when input already includes them", () => {
		const config: ProviderConfig = {
			providerId: "openai-native",
			modelId: "gpt-test",
			apiKey: "test-key",
			knownModels: {
				"gpt-test": {
					id: "gpt-test",
					pricing: {
						input: 1,
						output: 2,
						cacheRead: 0.5,
					},
				},
			},
		};
		const handler = new TestHandler(config);

		const cost = handler.computeCostFromInclusiveInput(100, 40, 25);

		expect(cost).toBeCloseTo(0.0001675, 10);
	});

	it("does not charge cache writes twice when input already includes them", () => {
		const config: ProviderConfig = {
			providerId: "openai-native",
			modelId: "gpt-test",
			apiKey: "test-key",
			knownModels: {
				"gpt-test": {
					id: "gpt-test",
					pricing: {
						input: 1,
						output: 2,
						cacheRead: 0.5,
						cacheWrite: 1.25,
					},
				},
			},
		};
		const handler = new TestHandler(config);

		const cost = handler.computeCostFromInclusiveInput(100, 40, 25, 10);

		expect(cost).toBeCloseTo(0.00017, 10);
	});
});

describe("BaseHandler abort signal wiring", () => {
	it("does not let a stale request signal abort a newer request", () => {
		const logger = {
			debug: vi.fn(),
			warn: vi.fn(),
		};
		const request1 = new AbortController();
		const handler = new TestHandler({
			providerId: "openrouter",
			modelId: "mock-model",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			abortSignal: request1.signal,
			logger,
		});

		const signal1 = handler.exposeAbortSignal();
		expect(signal1.aborted).toBe(false);

		const request2 = new AbortController();
		handler.setAbortSignal(request2.signal);
		const signal2 = handler.exposeAbortSignal();
		expect(signal2).not.toBe(signal1);
		expect(signal2.aborted).toBe(false);

		request1.abort(new Error("stale timeout"));

		expect(signal1.aborted).toBe(true);
		expect(signal2.aborted).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			"Provider request abort signal fired",
			expect.objectContaining({
				reason: expect.objectContaining({ message: "stale timeout" }),
			}),
		);
	});

	it("creates a fresh controller for each request", () => {
		const handler = new TestHandler({
			providerId: "openrouter",
			modelId: "mock-model",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
			abortSignal: new AbortController().signal,
		});

		const signal1 = handler.exposeAbortSignal();
		const signal2 = handler.exposeAbortSignal();

		expect(signal2).not.toBe(signal1);
		expect(signal1.aborted).toBe(false);
		expect(signal2.aborted).toBe(false);
	});
});

describe("BaseHandler.normalizeOpenAICompatibleBadRequest", () => {
	it("rewrites provider metadata prompt-limit errors into a helpful message", () => {
		const handler = new TestHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://openrouter.ai/api/v1",
		});

		const error = Object.assign(new Error("400 Provider returned error"), {
			status: 400,
			error: {
				message: "Provider returned error",
				code: 400,
				metadata: {
					provider_name: "Anthropic",
					raw: JSON.stringify({
						type: "error",
						error: {
							type: "invalid_request_error",
							message: "prompt is too long: 1102640 tokens > 1000000 maximum",
						},
						request_id: "req_123",
					}),
				},
			},
		});

		const normalized = handler.normalizeBadRequest(error);

		expect(normalized?.message).toBe(
			"Anthropic request was rejected (HTTP 400). Prompt is too long: 1102640 tokens exceeds the 1000000 token limit. Request ID: req_123.",
		);
		expect(normalized?.cause).toBe(error);
	});

	it("returns undefined for non-400 errors", () => {
		const handler = new TestHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://openrouter.ai/api/v1",
		});

		const normalized = handler.normalizeBadRequest(
			Object.assign(new Error("500 Provider returned error"), {
				status: 500,
			}),
		);

		expect(normalized).toBeUndefined();
	});
});
