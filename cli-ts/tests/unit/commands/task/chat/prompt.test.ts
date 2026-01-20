/**
 * Tests for prompt builder functions
 */

import { expect } from "chai"
import { buildPromptString } from "../../../../../src/commands/task/chat/prompt.js"

describe("prompt", () => {
	describe("buildPromptString", () => {
		it("should include mode indicator for act mode", () => {
			const result = buildPromptString("act", "openrouter", "anthropic/claude-3")
			expect(result).to.include("[act]")
		})

		it("should include mode indicator for plan mode", () => {
			const result = buildPromptString("plan", "openrouter", "anthropic/claude-3")
			expect(result).to.include("[plan]")
		})

		it("should include provider in prompt", () => {
			const result = buildPromptString("act", "openrouter", "anthropic/claude-3")
			expect(result).to.include("openrouter")
		})

		it("should include model ID in prompt", () => {
			const result = buildPromptString("act", "openrouter", "anthropic/claude-3")
			expect(result).to.include("anthropic/claude-3")
		})

		it("should show unknown for undefined provider", () => {
			const result = buildPromptString("act", undefined, "model-id")
			expect(result).to.include("unknown")
		})

		it("should show unknown for undefined model ID", () => {
			const result = buildPromptString("act", "openrouter", undefined)
			expect(result).to.include("unknown")
		})

		it("should truncate very long model IDs", () => {
			const longModelId = "organization/very-long-model-name-that-exceeds-the-forty-character-limit-for-display"
			const result = buildPromptString("act", "openrouter", longModelId)
			// Should be truncated
			expect(result.length).to.be.lessThan(longModelId.length + 50) // Account for other parts
			expect(result).to.include("...")
		})

		it("should preserve last part of model ID after slash when truncating", () => {
			const longModelId = "organization/subpath/very-specific-model-version-name"
			const result = buildPromptString("act", "openrouter", longModelId)
			// Should keep the part after the last slash
			expect(result).to.include("/very-specific-model-version-name")
		})

		it("should end with > prompt character", () => {
			const result = buildPromptString("act", "openrouter", "model")
			expect(result).to.include(">")
		})
	})
})
