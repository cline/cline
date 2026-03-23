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
	): number | undefined {
		return this.calculateCost(inputTokens, outputTokens, cacheReadTokens);
	}

	public exposeAbortSignal(): AbortSignal {
		return this.getAbortSignal();
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

		expect(cost).toBeCloseTo(17.73, 6);
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
