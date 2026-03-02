import { expect } from "chai"
import { checkContextWindowExceededError } from "../context-error-handling"

describe("checkContextWindowExceededError", () => {
	it("detects wrapped OpenRouter context errors when status is only in message text", () => {
		const error = new Error(
			'OpenRouter API Error 400: 400 This endpoint\'s maximum context length is 204800 tokens. However, you requested about 244027 tokens (112955 of text input, 131072 in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.',
		)

		expect(checkContextWindowExceededError(error)).to.equal(true)
	})

	it("detects OpenRouter JSON-encoded code + context length errors", () => {
		const error = new Error(
			'OpenRouter Mid-Stream Error: {"code":400,"message":"This endpoint\'s maximum context length is 200000 tokens"}',
		)

		expect(checkContextWindowExceededError(error)).to.equal(true)
	})

	it("does not classify unrelated 400 errors as context window failures", () => {
		const error = new Error("OpenRouter API Error 400: Invalid API key")

		expect(checkContextWindowExceededError(error)).to.equal(false)
	})
})
