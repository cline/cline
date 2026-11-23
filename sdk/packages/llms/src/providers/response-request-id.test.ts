import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import {
	extractResponseRequestId,
	findRequestIdHeader,
} from "./response-request-id";

function apiCallError(responseHeaders?: Record<string, string>) {
	return new APICallError({
		message: "Bad Gateway",
		url: "https://api.cline.bot/api/v1/chat/completions",
		requestBodyValues: {},
		statusCode: 502,
		responseHeaders,
	});
}

describe("findRequestIdHeader", () => {
	it("matches the header case-insensitively and trims it", () => {
		expect(findRequestIdHeader({ "X-Request-ID": " req_1 " })).toBe("req_1");
	});

	it("returns undefined for missing or blank headers", () => {
		expect(findRequestIdHeader(undefined)).toBeUndefined();
		expect(findRequestIdHeader({ "x-request-id": "  " })).toBeUndefined();
	});
});

describe("extractResponseRequestId", () => {
	it("reads a top-level APICallError", () => {
		expect(
			extractResponseRequestId(apiCallError({ "x-request-id": "req_top" })),
		).toBe("req_top");
	});

	it("walks the cause chain to a wrapped APICallError", () => {
		const wrapped = new Error("outer", {
			cause: new Error("middle", {
				cause: apiCallError({ "x-request-id": "req_nested" }),
			}),
		});
		expect(extractResponseRequestId(wrapped)).toBe("req_nested");
	});

	it("stops at the depth guard on cyclic causes", () => {
		const a = new Error("a") as Error & { cause?: unknown };
		const b = new Error("b", { cause: a });
		a.cause = b;
		expect(extractResponseRequestId(a)).toBeUndefined();
	});

	it("falls back to earlier RetryError attempts newest-first", () => {
		const error = new RetryError({
			message: "Failed after 3 attempts",
			reason: "maxRetriesExceeded",
			errors: [
				apiCallError({ "x-request-id": "req_first" }),
				apiCallError({ "x-request-id": "req_second" }),
				apiCallError(),
			],
		});
		expect(extractResponseRequestId(error)).toBe("req_second");
	});

	it("prefers RetryError.lastError when it has a request id", () => {
		const error = new RetryError({
			message: "Failed after 2 attempts",
			reason: "maxRetriesExceeded",
			errors: [
				apiCallError({ "x-request-id": "req_first" }),
				apiCallError({ "x-request-id": "req_last" }),
			],
		});
		expect(extractResponseRequestId(error)).toBe("req_last");
	});
});
