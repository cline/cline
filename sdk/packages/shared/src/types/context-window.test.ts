import { describe, expect, it } from "vitest";
import {
	isContextWindowExceededError,
	parseContextWindowLimitFromError,
} from "./context-window";

describe("isContextWindowExceededError", () => {
	it("matches the Anthropic hard-limit error from #9660", () => {
		expect(
			isContextWindowExceededError(
				new Error("prompt is too long: 228307 tokens > 200000 maximum"),
			),
		).toBe(true);
	});

	it("matches the tokens-over-maximum shape on its own", () => {
		expect(
			isContextWindowExceededError(new Error("400000 tokens > 200000 maximum")),
		).toBe(true);
	});

	it("matches OpenAI context-length phrasings", () => {
		expect(
			isContextWindowExceededError(
				new Error("This model's maximum context length is 128000 tokens"),
			),
		).toBe(true);
		expect(
			isContextWindowExceededError(new Error("context_length_exceeded")),
		).toBe(true);
	});

	it("matches the Gemini maximum-number-of-tokens phrasing", () => {
		expect(
			isContextWindowExceededError(
				new Error(
					"The input token count exceeds the maximum number of tokens allowed",
				),
			),
		).toBe(true);
	});

	it("matches a non-Error string value", () => {
		expect(
			isContextWindowExceededError("PROMPT IS TOO LONG: 5 tokens > 4 maximum"),
		).toBe(true);
	});

	it("does NOT match auth errors", () => {
		expect(isContextWindowExceededError(new Error("401 Unauthorized"))).toBe(
			false,
		);
		expect(isContextWindowExceededError(new Error("invalid token"))).toBe(
			false,
		);
	});

	it("does NOT match generic 400s or unrelated errors", () => {
		expect(
			isContextWindowExceededError(
				new Error("400 Bad Request: invalid_request_error"),
			),
		).toBe(false);
		expect(isContextWindowExceededError(new Error("ECONNRESET"))).toBe(false);
	});

	it("does NOT fire on a message that merely mentions tokens", () => {
		expect(
			isContextWindowExceededError(new Error("used 50 tokens this turn")),
		).toBe(false);
	});

	it("handles null and empty values", () => {
		expect(isContextWindowExceededError(null)).toBe(false);
		expect(isContextWindowExceededError(undefined)).toBe(false);
		expect(isContextWindowExceededError("")).toBe(false);
	});
});

describe("parseContextWindowLimitFromError", () => {
	it("parses the real limit from the #9660 error", () => {
		expect(
			parseContextWindowLimitFromError(
				new Error("prompt is too long: 228307 tokens > 200000 maximum"),
			),
		).toBe(200000);
	});

	it("parses a comma-separated limit", () => {
		expect(
			parseContextWindowLimitFromError(
				new Error("input is too long: 300,000 tokens > 200,000 maximum"),
			),
		).toBe(200000);
	});

	it("returns undefined when no limit is present", () => {
		expect(
			parseContextWindowLimitFromError(new Error("context_length_exceeded")),
		).toBeUndefined();
		expect(
			parseContextWindowLimitFromError(new Error("401 Unauthorized")),
		).toBeUndefined();
	});
});
