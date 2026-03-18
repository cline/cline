import { expect } from "chai"
import { checkContextWindowExceededError } from "../context-error-handling"

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
})
