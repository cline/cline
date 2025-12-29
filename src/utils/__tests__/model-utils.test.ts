import { describe, it } from "mocha"
import "should"
import { isClaude4PlusModelFamily, shouldSkipReasoningForModel } from "../model-utils"

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

describe("isClaude4PlusModelFamily", () => {
	it("should return true for Claude 4+ model IDs with version numbers", () => {
		isClaude4PlusModelFamily("claude-sonnet-4-5-20250929").should.equal(true)
		isClaude4PlusModelFamily("claude-opus-4-1-20250805").should.equal(true)
		isClaude4PlusModelFamily("claude-haiku-4-5-20251001").should.equal(true)
		isClaude4PlusModelFamily("claude-4-sonnet").should.equal(true)
	})

	it("should return true for Claude Code short aliases (sonnet, opus)", () => {
		// These are used by ClaudeCodeHandler.getModel() and should be recognized as Claude 4+
		isClaude4PlusModelFamily("sonnet").should.equal(true)
		isClaude4PlusModelFamily("opus").should.equal(true)
	})

	it("should return false for Claude 3.x models", () => {
		isClaude4PlusModelFamily("claude-3-sonnet").should.equal(false)
		isClaude4PlusModelFamily("claude-3.5-sonnet").should.equal(false)
		isClaude4PlusModelFamily("claude-3-opus").should.equal(false)
	})

	it("should return false for non-Claude models", () => {
		isClaude4PlusModelFamily("gpt-4").should.equal(false)
		isClaude4PlusModelFamily("gemini-pro").should.equal(false)
		isClaude4PlusModelFamily("llama-3").should.equal(false)
	})
})
