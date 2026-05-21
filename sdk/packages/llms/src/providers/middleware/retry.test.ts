import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	calculateBackoffDelay,
	composeMiddleware,
	createRetryMiddleware,
	getRetryDelayFromError,
	isRetriableError,
	RetriableError,
} from "./retry";

describe("retry middleware", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("isRetriableError", () => {
		it("returns true for RetriableError instances", () => {
			const error = new RetriableError("Rate limited");
			expect(isRetriableError(error)).toBe(true);
		});

		it("returns true for 429 status code", () => {
			const error = { status: 429, message: "Too Many Requests" };
			expect(isRetriableError(error)).toBe(true);
		});

		it("returns true for 5xx status codes", () => {
			expect(isRetriableError({ status: 500 })).toBe(true);
			expect(isRetriableError({ status: 502 })).toBe(true);
			expect(isRetriableError({ status: 503 })).toBe(true);
			expect(isRetriableError({ status: 504 })).toBe(true);
		});

		it("returns false for 4xx status codes (except 429)", () => {
			expect(isRetriableError({ status: 400 })).toBe(false);
			expect(isRetriableError({ status: 401 })).toBe(false);
			expect(isRetriableError({ status: 403 })).toBe(false);
			expect(isRetriableError({ status: 404 })).toBe(false);
		});

		it("returns true for network error codes", () => {
			expect(isRetriableError({ code: "ECONNRESET" })).toBe(true);
			expect(isRetriableError({ code: "ETIMEDOUT" })).toBe(true);
			expect(isRetriableError({ code: "ECONNREFUSED" })).toBe(true);
			expect(isRetriableError({ code: "ENOTFOUND" })).toBe(true);
		});

		it("returns false for AbortError (intentional cancellation)", () => {
			expect(isRetriableError({ name: "AbortError" })).toBe(false);
		});

		it("returns true for FetchError", () => {
			expect(isRetriableError({ name: "FetchError" })).toBe(true);
		});

		it("returns true for rate limit messages", () => {
			expect(isRetriableError({ message: "Rate limit exceeded" })).toBe(true);
			expect(isRetriableError({ message: "Too many requests" })).toBe(true);
			expect(isRetriableError({ message: "Server overloaded" })).toBe(true);
		});

		it("returns false for non-retriable errors", () => {
			expect(isRetriableError({ status: 400, message: "Bad request" })).toBe(
				false,
			);
			expect(isRetriableError({ message: "Invalid API key" })).toBe(false);
			expect(isRetriableError(null)).toBe(false);
			expect(isRetriableError(undefined)).toBe(false);
		});
	});

	describe("getRetryDelayFromError", () => {
		it("returns delay from RetriableError", () => {
			const error = new RetriableError("Rate limited", 429, 5000);
			expect(getRetryDelayFromError(error)).toBe(5000);
		});

		it("returns delay from retry-after header (seconds)", () => {
			const error = { headers: { "retry-after": "30" } };
			expect(getRetryDelayFromError(error)).toBe(30000);
		});

		it("returns delay from Retry-After header (case insensitive)", () => {
			const error = { headers: { "Retry-After": "15" } };
			expect(getRetryDelayFromError(error)).toBe(15000);
		});

		it("returns delay from x-ratelimit-reset header", () => {
			const error = { headers: { "x-ratelimit-reset": "10" } };
			expect(getRetryDelayFromError(error)).toBe(10000);
		});

		it("returns delay from retryAfter property (number)", () => {
			const error = { retryAfter: 20 };
			expect(getRetryDelayFromError(error)).toBe(20000);
		});

		it("returns undefined for errors without retry info", () => {
			expect(getRetryDelayFromError({ message: "Error" })).toBeUndefined();
			expect(getRetryDelayFromError(null)).toBeUndefined();
		});
	});

	describe("calculateBackoffDelay", () => {
		it("calculates exponential backoff", () => {
			const baseDelay = 1000;
			const maxDelay = 30000;

			// Mock Math.random to return 0.5 (no jitter effect)
			vi.spyOn(Math, "random").mockReturnValue(0.5);

			expect(calculateBackoffDelay(0, baseDelay, maxDelay)).toBe(1000);
			expect(calculateBackoffDelay(1, baseDelay, maxDelay)).toBe(2000);
			expect(calculateBackoffDelay(2, baseDelay, maxDelay)).toBe(4000);
			expect(calculateBackoffDelay(3, baseDelay, maxDelay)).toBe(8000);
		});

		it("respects max delay", () => {
			vi.spyOn(Math, "random").mockReturnValue(0.5);
			expect(calculateBackoffDelay(10, 1000, 5000)).toBe(5000);
		});

		it("adds jitter to prevent thundering herd", () => {
			const results = new Set<number>();
			vi.spyOn(Math, "random").mockRestore();

			for (let i = 0; i < 10; i++) {
				results.add(calculateBackoffDelay(1, 1000, 30000));
			}

			// With jitter, we should get different values
			expect(results.size).toBeGreaterThan(1);
		});
	});

	describe("RetriableError", () => {
		it("creates error with default status 429", () => {
			const error = new RetriableError("Rate limited");
			expect(error.status).toBe(429);
			expect(error.message).toBe("Rate limited");
			expect(error.name).toBe("RetriableError");
		});

		it("creates error with custom status and retry delay", () => {
			const error = new RetriableError("Server error", 503, 10000);
			expect(error.status).toBe(503);
			expect(error.retryAfterMs).toBe(10000);
		});
	});

	describe("createRetryMiddleware", () => {
		it("retries on retriable errors", async () => {
			const onRetryAttempt = vi.fn();
			const middleware = createRetryMiddleware({
				maxRetries: 3,
				baseDelayMs: 100,
				onRetryAttempt,
			});

			let callCount = 0;
			const mockDoStream = vi.fn(async () => {
				callCount++;
				if (callCount < 3) {
					throw new RetriableError("Rate limited");
				}
				return {
					stream: (async function* () {
						yield {
							type: "text-delta",
							textDelta: "Hello",
						} as LanguageModelV3StreamPart;
					})(),
					rawCall: { rawPrompt: "", rawSettings: {} },
				};
			});

			const wrapStream = middleware.wrapStream!;
			const resultPromise = wrapStream({
				doStream: mockDoStream,
				params: {} as any,
				model: {} as any,
			});

			// Advance timers for retries
			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(200);

			const result = await resultPromise;
			expect(mockDoStream).toHaveBeenCalledTimes(3);
			expect(onRetryAttempt).toHaveBeenCalledTimes(2);
		});

		it("does not retry non-retriable errors", async () => {
			const middleware = createRetryMiddleware({ maxRetries: 3 });

			const mockDoStream = vi.fn(async () => {
				throw { status: 401, message: "Unauthorized" };
			});

			const wrapStream = middleware.wrapStream!;

			await expect(
				wrapStream({
					doStream: mockDoStream,
					params: {} as any,
					model: {} as any,
				}),
			).rejects.toMatchObject({ status: 401 });

			expect(mockDoStream).toHaveBeenCalledTimes(1);
		});

		it("throws after max retries exceeded", async () => {
			const middleware = createRetryMiddleware({
				maxRetries: 2,
				baseDelayMs: 10,
			});

			const mockDoStream = vi.fn(async () => {
				throw new RetriableError("Always fails");
			});

			const wrapStream = middleware.wrapStream!;
			const resultPromise = wrapStream({
				doStream: mockDoStream,
				params: {} as any,
				model: {} as any,
			});

			// Advance timers for all retries
			await vi.advanceTimersByTimeAsync(10);
			await vi.advanceTimersByTimeAsync(20);
			await vi.advanceTimersByTimeAsync(40);

			await expect(resultPromise).rejects.toBeInstanceOf(RetriableError);
			expect(mockDoStream).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
		});

		it("retries all errors when retryAllErrors is true", async () => {
			const middleware = createRetryMiddleware({
				maxRetries: 2,
				baseDelayMs: 10,
				retryAllErrors: true,
			});

			let callCount = 0;
			const mockDoStream = vi.fn(async () => {
				callCount++;
				if (callCount < 2) {
					throw { status: 400, message: "Bad request" };
				}
				return {
					stream: (async function* () {
						yield {
							type: "text-delta",
							textDelta: "Success",
						} as LanguageModelV3StreamPart;
					})(),
					rawCall: { rawPrompt: "", rawSettings: {} },
				};
			});

			const wrapStream = middleware.wrapStream!;
			const resultPromise = wrapStream({
				doStream: mockDoStream,
				params: {} as any,
				model: {} as any,
			});

			await vi.advanceTimersByTimeAsync(10);

			const result = await resultPromise;
			expect(mockDoStream).toHaveBeenCalledTimes(2);
		});

		it("uses retry-after header delay when available", async () => {
			const onRetryAttempt = vi.fn();
			const middleware = createRetryMiddleware({
				maxRetries: 2,
				baseDelayMs: 1000,
				onRetryAttempt,
			});

			let callCount = 0;
			const mockDoStream = vi.fn(async () => {
				callCount++;
				if (callCount < 2) {
					const error = { status: 429, headers: { "retry-after": "5" } };
					throw error;
				}
				return {
					stream: (async function* () {
						yield {
							type: "text-delta",
							textDelta: "Done",
						} as LanguageModelV3StreamPart;
					})(),
					rawCall: { rawPrompt: "", rawSettings: {} },
				};
			});

			const wrapStream = middleware.wrapStream!;
			const resultPromise = wrapStream({
				doStream: mockDoStream,
				params: {} as any,
				model: {} as any,
			});

			// Should use 5000ms from header, not 1000ms base delay
			await vi.advanceTimersByTimeAsync(5000);

			await resultPromise;
			expect(onRetryAttempt).toHaveBeenCalledWith(
				1,
				2,
				5000,
				expect.any(Object),
			);
		});
	});

	describe("composeMiddleware", () => {
		it("composes multiple middlewares", async () => {
			const order: string[] = [];

			const middleware1 = createRetryMiddleware({
				maxRetries: 1,
				baseDelayMs: 10,
				onRetryAttempt: () => order.push("retry1"),
			});

			const middleware2: any = {
				specificationVersion: "v3",
				transformParams: async ({ params }: any) => {
					order.push("transform2");
					return params;
				},
			};

			const composed = composeMiddleware(middleware1, middleware2);

			expect(composed.specificationVersion).toBe("v3");
			expect(composed.transformParams).toBeDefined();
			expect(composed.wrapStream).toBeDefined();
		});

		it("applies transformParams in order", async () => {
			const order: string[] = [];

			const middleware1: any = {
				specificationVersion: "v3",
				transformParams: async ({ params }: any) => {
					order.push("first");
					return { ...params, first: true };
				},
			};

			const middleware2: any = {
				specificationVersion: "v3",
				transformParams: async ({ params }: any) => {
					order.push("second");
					return { ...params, second: true };
				},
			};

			const composed = composeMiddleware(middleware1, middleware2);
			const result = await composed.transformParams!({
				params: { original: true } as any,
				model: {} as any,
			});

			expect(order).toEqual(["first", "second"]);
			expect(result).toMatchObject({
				original: true,
				first: true,
				second: true,
			});
		});
	});
});
