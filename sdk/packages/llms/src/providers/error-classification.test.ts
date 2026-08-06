import {
	APICallError,
	NoOutputGeneratedError,
	RetryError,
	TypeValidationError,
} from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "./error-classification";

describe("classifyProviderError", () => {
	describe("context_window_exceeded", () => {
		it("classifies the gateway-forwarded Alibaba Qwen rejection (captured shape)", () => {
			// Same payload format.test.ts verifies extractErrorMessage against.
			expect(
				classifyProviderError({
					code: "error",
					message: "Stream error occurred",
					name: "AI_TypeValidationError",
					cause: {
						name: "ZodError",
						message:
							'[\n  {\n    "code": "invalid_union",\n    "path": [],\n    "message": "Invalid input"\n  }\n]',
					},
					value: {
						error_type: "validation_error",
						error_message: JSON.stringify({
							error: {
								message:
									"This model's maximum context length is 40960 tokens. However, you requested 100 output tokens and your prompt contains at least 40861 input tokens.",
								code: 400,
							},
						}),
					},
				}),
			).toBe("context_window_exceeded");
		});

		it("classifies an AI SDK APICallError-shaped 400 with context detail in responseBody", () => {
			const error = Object.assign(new Error("Bad Request"), {
				name: "AI_APICallError",
				statusCode: 400,
				responseBody: JSON.stringify({
					error: {
						message:
							"This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
						type: "invalid_request_error",
						code: "context_length_exceeded",
					},
				}),
			});
			expect(classifyProviderError(error)).toBe("context_window_exceeded");
		});

		it("classifies by explicit context_length_exceeded code alone", () => {
			expect(
				classifyProviderError({
					error: { code: "context_length_exceeded" },
				}),
			).toBe("context_window_exceeded");
		});

		it("classifies Anthropic prompt-too-long rejections", () => {
			expect(
				classifyProviderError({
					status: 400,
					error: {
						type: "invalid_request_error",
						message: "prompt is too long: 213462 tokens > 200000 maximum",
					},
				}),
			).toBe("context_window_exceeded");
		});

		it("classifies Bedrock input-too-long validation errors", () => {
			const error = Object.assign(new Error("Bad Request"), {
				name: "AI_APICallError",
				statusCode: 400,
				responseBody: JSON.stringify({
					message: "Input is too long for requested model.",
				}),
			});
			expect(classifyProviderError(error)).toBe("context_window_exceeded");
		});

		it("classifies Cerebras reduce-the-length rejections", () => {
			expect(
				classifyProviderError({
					statusCode: 400,
					message: "Please reduce the length of the messages or completion.",
				}),
			).toBe("context_window_exceeded");
		});

		it("classifies OpenRouter errors JSON-encoded into the message string", () => {
			expect(
				classifyProviderError(
					new Error(
						'Provider returned error: {"error":{"message":"This endpoint\'s maximum context length is 65536 tokens.","code":400}}',
					),
				),
			).toBe("context_window_exceeded");
		});

		it("classifies an already-flattened message string", () => {
			expect(
				classifyProviderError(
					"input length and max_tokens exceed context limit: 199999 + 8192 > 200000",
				),
			).toBe("context_window_exceeded");
		});
	});

	describe("unknown", () => {
		it("vetoes token-per-minute rate limits despite token wording", () => {
			expect(
				classifyProviderError({
					status: 429,
					error: {
						type: "rate_limit_error",
						message:
							"Number of request tokens has exceeded your per-minute rate limit.",
					},
				}),
			).toBe("unknown");
		});

		it("vetoes rate-limit wording even without a status", () => {
			expect(
				classifyProviderError(
					new Error("Rate limit reached for gpt-4o on tokens per min (TPM)"),
				),
			).toBe("unknown");
		});

		it("vetoes context wording on a non-invalid-request status", () => {
			expect(
				classifyProviderError({
					statusCode: 500,
					message: "internal error computing context length",
				}),
			).toBe("unknown");
		});

		it("leaves auth errors unclassified", () => {
			expect(
				classifyProviderError({
					statusCode: 401,
					message: "invalid x-api-key",
				}),
			).toBe("unknown");
		});

		it("leaves generic stream failures unclassified", () => {
			expect(
				classifyProviderError(new Error("fetch failed: other side closed")),
			).toBe("unknown");
		});

		it("handles null, primitives, and empty objects", () => {
			expect(classifyProviderError(null)).toBe("unknown");
			expect(classifyProviderError(undefined)).toBe("unknown");
			expect(classifyProviderError(42)).toBe("unknown");
			expect(classifyProviderError({})).toBe("unknown");
		});

		it("survives self-referential error objects", () => {
			const cyclic: Record<string, unknown> = { message: "boom" };
			cyclic.cause = cyclic;
			expect(classifyProviderError(cyclic)).toBe("unknown");
		});
	});

	describe("typed AI SDK error instances", () => {
		const overflowApiCallError = () =>
			new APICallError({
				message: "Bad Request",
				url: "https://api.anthropic.com/v1/messages",
				requestBodyValues: {},
				statusCode: 400,
				responseBody: JSON.stringify({
					type: "error",
					error: {
						type: "invalid_request_error",
						message: "prompt is too long: 213462 tokens > 200000 maximum",
					},
				}),
			});

		it("classifies an APICallError 400 with a prompt-too-long body", () => {
			expect(classifyProviderError(overflowApiCallError())).toBe(
				"context_window_exceeded",
			);
		});

		it("treats the typed statusCode as authoritative: 429 vetoes token wording", () => {
			const error = new APICallError({
				message: "Too Many Requests",
				url: "https://api.anthropic.com/v1/messages",
				requestBodyValues: {},
				statusCode: 429,
				responseBody: JSON.stringify({
					error: {
						message: "Request tokens exceed your available quota.",
					},
				}),
			});
			expect(classifyProviderError(error)).toBe("unknown");
		});

		it("treats the typed statusCode as authoritative: 500 vetoes context wording", () => {
			const error = new APICallError({
				message: "Internal Server Error",
				url: "https://api.openai.com/v1/chat/completions",
				requestBodyValues: {},
				statusCode: 500,
				responseBody: JSON.stringify({
					error: {
						message: "internal error computing maximum context length",
					},
				}),
			});
			expect(classifyProviderError(error)).toBe("unknown");
		});

		it("treats the typed statusCode as authoritative: an explicit overflow code cannot override it", () => {
			const withStatus = (statusCode: number) =>
				new APICallError({
					message: "Request failed",
					url: "https://api.openai.com/v1/chat/completions",
					requestBodyValues: {},
					statusCode,
					responseBody: JSON.stringify({
						error: {
							message: "This model's maximum context length is 128000 tokens.",
							code: "context_length_exceeded",
						},
					}),
				});
			expect(classifyProviderError(withStatus(429))).toBe("unknown");
			expect(classifyProviderError(withStatus(500))).toBe("unknown");
			// The gate must not swallow genuine overflow rejections.
			expect(classifyProviderError(withStatus(400))).toBe(
				"context_window_exceeded",
			);
		});

		it("unwraps a RetryError to its last attempt's error", () => {
			const error = new RetryError({
				message: "Failed after 3 attempts.",
				reason: "maxRetriesExceeded",
				errors: [new Error("fetch failed"), overflowApiCallError()],
			});
			expect(classifyProviderError(error)).toBe("context_window_exceeded");
		});

		it("classifies an untyped final RetryError attempt without earlier attempts vetoing it", () => {
			// Attempt 1 was a retryable 429; the final attempt is a plain
			// (untyped) overflow rejection. The earlier rate limit must not
			// veto the final attempt's verdict.
			const error = new RetryError({
				message: "Failed after 2 attempts.",
				reason: "errorNotRetryable",
				errors: [
					new APICallError({
						message: "Too Many Requests",
						url: "https://api.anthropic.com/v1/messages",
						requestBodyValues: {},
						statusCode: 429,
						responseBody: JSON.stringify({
							error: {
								type: "rate_limit_error",
								message: "Rate limit reached.",
							},
						}),
					}),
					{
						status: 400,
						error: {
							type: "invalid_request_error",
							message: "prompt is too long: 213462 tokens > 200000 maximum",
						},
					},
				],
			});
			expect(classifyProviderError(error)).toBe("context_window_exceeded");
		});

		it("does not let earlier RetryError attempts fake an overflow for an untyped final attempt", () => {
			const error = new RetryError({
				message: "Failed after 2 attempts.",
				reason: "errorNotRetryable",
				errors: [
					{
						status: 400,
						error: {
							message: "prompt is too long: 213462 tokens > 200000 maximum",
						},
					},
					new Error("fetch failed: other side closed"),
				],
			});
			expect(classifyProviderError(error)).toBe("unknown");
		});

		it("classifies a TypeValidationError by the gateway payload in value", () => {
			// A real instance of the ENG-2394 failure: the Vercel gateway streams
			// the upstream rejection as the value that failed schema validation.
			const error = new TypeValidationError({
				value: {
					error_type: "validation_error",
					error_message: JSON.stringify({
						error: {
							message:
								"This model's maximum context length is 40960 tokens. However, you requested 100 output tokens and your prompt contains at least 40861 input tokens.",
							code: 400,
						},
					}),
				},
				cause: Object.assign(
					new Error(
						'[\n  {\n    "code": "invalid_union",\n    "path": [],\n    "message": "Invalid input"\n  }\n]',
					),
					{ name: "ZodError" },
				),
			});
			expect(classifyProviderError(error)).toBe("context_window_exceeded");
		});

		it("recurses through a generic AISDKError wrapper's cause", () => {
			const error = new NoOutputGeneratedError({
				message: "No output generated.",
				cause: overflowApiCallError(),
			});
			expect(classifyProviderError(error)).toBe("context_window_exceeded");
		});
	});
});
