import { describe, expect, it } from "vitest";
import { isTranscriptionNetworkError } from "./transcription-network-error";

describe("transcription network errors", () => {
	it.each([
		"fetch failed",
		"Failed to fetch",
		"Load failed",
		"connect ECONNREFUSED",
		"Streaming transcription network connection was lost",
	])("recognizes %s across the sidecar boundary", (message) => {
		expect(isTranscriptionNetworkError(new Error(message))).toBe(true);
	});
	it.each([
		"Unauthorized",
		"Rate limit exceeded",
		"Model not found",
		"Permission denied",
		"Streaming transcription connection failed",
	])("does not hide %s", (message) => {
		expect(isTranscriptionNetworkError(new Error(message))).toBe(false);
	});
	it("does not treat cancellation or HTTP responses as networking failures", () => {
		expect(
			isTranscriptionNetworkError(
				new DOMException("fetch failed", "AbortError"),
			),
		).toBe(false);
		expect(
			isTranscriptionNetworkError({ statusCode: 401, message: "fetch failed" }),
		).toBe(false);
	});
	it("recognizes nested network causes without looping", () => {
		expect(
			isTranscriptionNetworkError(
				new Error("Transcription failed", {
					cause: new TypeError("fetch failed"),
				}),
			),
		).toBe(true);
		const error = new Error("Other error");
		error.cause = error;
		expect(isTranscriptionNetworkError(error)).toBe(false);
	});
});
