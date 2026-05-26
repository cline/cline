import { describe, expect, it, vi } from "vitest";
import {
	calculateBackoffDelay,
	getRetryDelayFromError,
	isRetriableError,
	RetriableError,
} from "./retry";

describe("retry middleware", () => {
	describe("isRetriableError", () => {
		it("returns true for RetriableError instances", () => {
			const error = new RetriableError("Rate limited");
			expect(isRetriableError(error)).toBe(true);
		});

		it("returns true for 429 status code", () => {
			expect(isRetriableError({ status: 429 })).toBe(true);
		});

		it("returns true for 5xx status codes", () => {
			expect(isRetriableError({ status: 500 })).toBe(true);
			expect(isRetriableError({ status: 503 })).toBe(true);
		});

		it("returns false for 4xx status codes (except 429)", () => {
			expect(isRetriableError({ status: 400 })).toBe(false);
			expect(isRetriableError({ status: 401 })).toBe(false);
		});

		it("returns true for network error codes", () => {
			expect(isRetriableError({ code: "ECONNRESET" })).toBe(true);
			expect(isRetriableError({ code: "ETIMEDOUT" })).toBe(true);
		});

		it("returns false for non-retriable errors", () => {
			expect(isRetriableError({ message: "Invalid API key" })).toBe(false);
			expect(isRetriableError(null)).toBe(false);
		});
	});

	describe("getRetryDelayFromError", () => {
		it("returns delay from RetriableError", () => {
			const error = new RetriableError("Rate limited", 429, 5000);
			expect(getRetryDelayFromError(error)).toBe(5000);
		});

		it("returns delay from retry-after header", () => {
			const error = { headers: { "retry-after": "30" } };
			expect(getRetryDelayFromError(error)).toBe(30000);
		});

		it("returns undefined for errors without retry info", () => {
			expect(getRetryDelayFromError({ message: "Error" })).toBeUndefined();
		});
	});

	describe("calculateBackoffDelay", () => {
		it("calculates exponential backoff", () => {
			vi.spyOn(Math, "random").mockReturnValue(0.5);

			expect(calculateBackoffDelay(0, 1000, 30000)).toBe(1000);
			expect(calculateBackoffDelay(1, 1000, 30000)).toBe(2000);
			expect(calculateBackoffDelay(2, 1000, 30000)).toBe(4000);

			vi.spyOn(Math, "random").mockRestore();
		});

		it("respects max delay", () => {
			vi.spyOn(Math, "random").mockReturnValue(0.5);
			expect(calculateBackoffDelay(10, 1000, 5000)).toBe(5000);
			vi.spyOn(Math, "random").mockRestore();
		});
	});

	describe("RetriableError", () => {
		it("creates error with default status 429", () => {
			const error = new RetriableError("Rate limited");
			expect(error.status).toBe(429);
			expect(error.name).toBe("RetriableError");
		});

		it("creates error with custom status and retry delay", () => {
			const error = new RetriableError("Server error", 503, 10000);
			expect(error.status).toBe(503);
			expect(error.retryAfterMs).toBe(10000);
		});
	});
});
