import { describe, expect, it } from "vitest";
import { errorDetail, userErrorMessage } from "./error-message";

describe("userErrorMessage", () => {
	it("replaces Android native fetch IO failures with delivery uncertainty while retaining diagnostics", () => {
		const nativeMessage =
			"fetch failed: java.io.IOException: unexpected end of stream on http://127.0.0.1:4783/...";
		for (const error of [
			new TypeError(nativeMessage),
			nativeMessage,
			{ error: { message: nativeMessage } },
			JSON.stringify({ error: { message: nativeMessage } }),
		]) {
			expect(userErrorMessage(error, "Couldn't stop this workspace.")).toBe(
				"The request was interrupted. Check whether it completed before trying again.",
			);
			expect(errorDetail(error)).toBe(nativeMessage);
		}
		for (const message of [
			"java.io.IOException: Connection reset (at okhttp3.internal.http1.Http1ExchangeCodec)",
			"fetch failed: java.io.EOFException: unexpected end of stream",
			"fetch failed: java.net.SocketException: Connection reset",
		]) {
			expect(userErrorMessage(new Error(message), "Fallback")).toBe(
				"The request was interrupted. Check whether it completed before trying again.",
			);
		}
		for (const message of [
			"Could not stop this workspace (503).",
			"The tool reported java.io.IOException while reading your file.",
		]) {
			expect(userErrorMessage(new Error(message), "Fallback")).toBe(message);
		}
	});
	it("replaces the native Expo canceled-fetch stack with honest delivery uncertainty", () => {
		const nativeMessage =
			"fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)";
		for (const error of [
			new Error(nativeMessage),
			nativeMessage,
			{ error: { message: nativeMessage } },
		]) {
			expect(
				userErrorMessage(error, "Couldn't update this session. Try again."),
			).toBe(
				"The request was interrupted. Check whether it completed before trying again.",
			);
		}
		expect(
			userErrorMessage(new Error("The request timed out"), "Fallback"),
		).toBe(
			"The request took too long. Check whether it completed before trying again.",
		);
		expect(
			userErrorMessage(
				new Error("Could not rename this conversation (503)."),
				"Fallback",
			),
		).toBe("Could not rename this conversation (503).");
	});
	it("parses the full nested response before bounding the displayed message", () => {
		const response = JSON.stringify({
			error: {
				message: "Provider rejected this model.",
				metadata: "x".repeat(500),
			},
		});
		expect(
			userErrorMessage(
				`Failed to create stream: request failed with status 403: ${response}`,
				"Fallback",
			),
		).toBe("Provider rejected this model.");
	});

	it("explains a provider key limit without exposing its internal management URL", () => {
		const response = JSON.stringify({
			error: {
				message: `Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/${"x".repeat(160)}`,
				code: 403,
			},
		});
		expect(
			userErrorMessage(
				`Failed to create stream: inference request failed: failed to generate stream from OpenRouter: failed to invoke model with streaming: request failed with status 403: ${response}`,
				"Fallback",
			),
		).toBe(
			"This model's provider has reached its spending limit. Choose another model or try again later.",
		);
	});

	it("keeps an ordinary error sentence", () => {
		expect(
			userErrorMessage(new Error("Please sign in again."), "Fallback"),
		).toBe("Please sign in again.");
	});

	it("unwraps common object and JSON API error shapes", () => {
		expect(
			userErrorMessage(
				{ error: { message: "Repository access expired." } },
				"Fallback",
			),
		).toBe("Repository access expired.");
		expect(
			userErrorMessage(
				new Error(
					'Request failed (403) - {"error":{"message":"Reconnect GitHub."}}',
				),
				"Fallback",
			),
		).toBe("Reconnect GitHub.");
	});

	it("uses the fallback for empty blobs, opaque objects, and HTML", () => {
		for (const error of [
			{},
			"{}",
			[],
			"[object Object]",
			"<html>nope</html>",
		]) {
			expect(userErrorMessage(error, "Please try again.")).toBe(
				"Please try again.",
			);
		}
	});

	it("turns transport failures into actionable copy", () => {
		expect(
			userErrorMessage(new TypeError("Network request failed"), "Fallback"),
		).toBe(
			"Cline couldn't reach the service. Check your connection and try again.",
		);
		expect(
			userErrorMessage(new Error("The operation was aborted"), "Fallback"),
		).toBe("The operation was aborted");
		expect(
			userErrorMessage(
				new Error("Cline setup request failed (500)."),
				"Setup failed.",
			),
		).toBe("Setup failed.");
	});

	it("bounds server-controlled text", () => {
		const message = userErrorMessage({ message: "x".repeat(500) }, "Fallback");
		expect(message).toHaveLength(320);
		expect(message.endsWith("…")).toBe(true);
	});
});

describe("errorDetail", () => {
	it("omits diagnostics that have no readable text", () => {
		expect(errorDetail({ error: {} })).toBeUndefined();
	});
});
