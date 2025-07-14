import { describe, it } from "mocha"
import "should"
import { shouldSkipReasoningForModel } from "../model-utils"

describe("shouldSkipReasoningForModel", () => {
	it("should return true for grok-4 models", () => {
		shouldSkipReasoningForModel("grok-4").should.equal(true)
		shouldSkipReasoningForModel("x-ai/grok-4").should.equal(true)
		shouldSkipReasoningForModel("openrouter/grok-4-turbo").should.equal(true)
		shouldSkipReasoningForModel("some-provider/grok-4-mini").should.equal(true)
	})

	it("should return false for non-grok-4 models", () => {
		shouldSkipReasoningForModel("grok-3").should.equal(false)
		shouldSkipReasoningForModel("grok-2").should.equal(false)
		shouldSkipReasoningForModel("claude-3-sonnet").should.equal(false)
		shouldSkipReasoningForModel("gpt-4").should.equal(false)
		shouldSkipReasoningForModel("gemini-pro").should.equal(false)
	})

	it("should return false for undefined or empty model IDs", () => {
		shouldSkipReasoningForModel(undefined).should.equal(false)
		shouldSkipReasoningForModel("").should.equal(false)
	})

	it("should be case sensitive", () => {
		shouldSkipReasoningForModel("GROK-4").should.equal(false)
		shouldSkipReasoningForModel("Grok-4").should.equal(false)
	})
})
