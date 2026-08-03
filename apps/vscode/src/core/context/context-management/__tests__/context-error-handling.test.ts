import { APIError } from "@anthropic-ai/sdk"
import { expect } from "chai"
import { checkContextWindowExceededError, checkIsAnthropicContextWindowError } from "../context-error-handling"

describe("checkContextWindowExceededError", () => {
	it("detects OpenRouter context errors using structured status", () => {
		const error = Object.assign(
			new Error(
				"This endpoint's maximum context length is 204800 tokens. However, you requested about 244027 tokens.",
			),
			{
				status: 400,
			},
		)

		expect(checkContextWindowExceededError(error)).to.equal(true)
	})

	it("detects OpenRouter JSON-encoded status + context length errors", () => {
		const error = new Error(
			'OpenRouter Mid-Stream Error: {"status":400,"message":"This endpoint\'s maximum context length is 200000 tokens"}',
		)

		expect(checkContextWindowExceededError(error)).to.equal(true)
	})

	it("does not classify unrelated 400 errors as context window failures", () => {
		const error = new Error("OpenRouter API Error 400: Invalid API key")

		expect(checkContextWindowExceededError(error)).to.equal(false)
	})

	it("classifies a real Anthropic overflow error as a context window failure", () => {
		expect(
			checkContextWindowExceededError(makeAnthropicError("prompt is too long: 213462 tokens > 200000 maximum")),
		).to.equal(true)
	})

	it("does not classify an unrelated Anthropic invalid_request_error as a context window failure", () => {
		const error = makeAnthropicError("tools.0.custom.input_schema: Extra inputs are not permitted")

		expect(checkContextWindowExceededError(error)).to.equal(false)
	})
})

/**
 * Builds the shape an Anthropic API rejection has by the time it reaches the detector: the SDK's
 * `APIError` carries the parsed response body on `error`, so the provider's own error object is
 * nested at `error.error`.
 */
function makeAnthropicError(message: string, type = "invalid_request_error", status = 400) {
	return {
		status,
		message: `${status} ${JSON.stringify({ type: "error", error: { type, message } })}`,
		error: {
			type: "error",
			error: { type, message },
		},
	}
}

describe("checkIsAnthropicContextWindowError", () => {
	describe("real overflow rejections still auto-truncate", () => {
		// Anthropic's current overflow message, emitted when the rendered prompt alone exceeds the
		// model's context window.
		it("matches 'prompt is too long' with the token counts", () => {
			expect(
				checkIsAnthropicContextWindowError(makeAnthropicError("prompt is too long: 213462 tokens > 200000 maximum")),
			).to.equal(true)
		})

		// Emitted when the prompt fits but prompt + max_tokens does not.
		it("matches 'input length and max_tokens exceed context limit'", () => {
			const error = makeAnthropicError(
				"input length and max_tokens exceed context limit: 197000 + 8192 > 200000, decrease input length or max_tokens and try again",
			)

			expect(checkIsAnthropicContextWindowError(error)).to.equal(true)
		})

		it("matches the older 'input is too long' phrasing", () => {
			expect(checkIsAnthropicContextWindowError(makeAnthropicError("input is too long for requested model"))).to.equal(true)
		})

		it("matches when only the SDK's JSON-stringified message carries the overflow text", () => {
			const error = makeAnthropicError("prompt is too long: 213462 tokens > 200000 maximum")
			// Some wrappers hand us the error object without the provider message on the inner error.
			delete (error.error.error as { message?: string }).message

			expect(checkIsAnthropicContextWindowError(error)).to.equal(true)
		})

		it("matches an error constructed by the Anthropic SDK itself", () => {
			const body = {
				type: "error",
				error: { type: "invalid_request_error", message: "prompt is too long: 213462 tokens > 200000 maximum" },
			}
			const error = APIError.generate(400, body, undefined, new Headers())

			expect(checkIsAnthropicContextWindowError(error)).to.equal(true)
		})
	})

	describe("unrelated invalid_request_error rejections are not overflows", () => {
		// Each of these previously matched on the error type alone, triggering a conversation
		// truncation and a retry that then failed again for the original reason.
		const UNRELATED_MESSAGES = [
			"tools.0.custom.input_schema: Extra inputs are not permitted",
			"messages.1.content.0.image.source.base64: image exceeds 5 MB maximum: 6291456 bytes > 5242880 bytes",
			"model: claude-not-a-real-model",
			"max_tokens: 100000 > 64000, which is the maximum allowed number of output tokens for claude-sonnet-4-5",
			"messages: at least one message is required",
			"messages.0: all messages must have non-empty content except for the optional final assistant message",
			"temperature: Input should be less than or equal to 1",
		]

		for (const message of UNRELATED_MESSAGES) {
			it(`does not match: ${message}`, () => {
				expect(checkIsAnthropicContextWindowError(makeAnthropicError(message))).to.equal(false)
			})
		}

		it("does not match an invalid_request_error with no message at all", () => {
			expect(
				checkIsAnthropicContextWindowError({ error: { type: "error", error: { type: "invalid_request_error" } } }),
			).to.equal(false)
		})

		it("does not match an invalid_request_error with a non-string message", () => {
			const error = makeAnthropicError("unused")
			;(error.error.error as { message?: unknown }).message = { detail: "structured" }
			error.message = ""

			expect(checkIsAnthropicContextWindowError(error)).to.equal(false)
		})
	})

	describe("non-invalid_request_error inputs", () => {
		it("does not match other Anthropic error types even with overflow-shaped text", () => {
			const error = makeAnthropicError("prompt is too long: 213462 tokens > 200000 maximum", "rate_limit_error", 429)

			expect(checkIsAnthropicContextWindowError(error)).to.equal(false)
		})

		it("does not match an overloaded_error", () => {
			expect(checkIsAnthropicContextWindowError(makeAnthropicError("Overloaded", "overloaded_error", 529))).to.equal(false)
		})

		for (const [label, value] of [
			["null", null],
			["undefined", undefined],
			["a plain string", "prompt is too long: 213462 tokens > 200000 maximum"],
			["an object with no error property", { message: "prompt is too long: 213462 tokens > 200000 maximum" }],
		] as const) {
			it(`does not match ${label}`, () => {
				expect(checkIsAnthropicContextWindowError(value)).to.equal(false)
			})
		}

		it("does not throw when property access throws", () => {
			const error = {
				get error(): never {
					throw new Error("boom")
				},
			}

			expect(checkIsAnthropicContextWindowError(error)).to.equal(false)
		})
	})
})
