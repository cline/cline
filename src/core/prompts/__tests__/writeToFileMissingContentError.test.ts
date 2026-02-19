import { describe, it } from "mocha"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse.writeToFileMissingContentError", () => {
	describe("first failure (tier 1)", () => {
		it("should include the file path in the error message", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.containEql("src/index.ts")
		})

		it("should include the base error explanation", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.containEql("'content' parameter was empty")
			result.should.containEql("output token limits")
		})

		it("should include helpful suggestions", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.containEql("Suggestions")
			result.should.containEql("replace_in_file")
			result.should.containEql("skeleton")
		})

		it("should include the tool use instructions reminder", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.containEql("Reminder: Instructions for Tool Use")
		})

		it("should mention breaking down the task into smaller steps", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.containEql("breaking down the task into smaller steps")
		})

		it("should suggest using replace_in_file for existing files", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.containEql("prefer replace_in_file to make targeted edits")
		})

		it("should not include CRITICAL language on first failure", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.not.containEql("CRITICAL")
		})

		it("should work with different file paths", () => {
			const result = formatResponse.writeToFileMissingContentError("components/MyComponent.tsx", 1)
			result.should.containEql("components/MyComponent.tsx")
		})
	})

	describe("second failure (tier 2)", () => {
		it("should indicate this is the 2nd failed attempt", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.containEql("2nd failed attempt")
		})

		it("should strongly suggest alternative approaches", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.containEql("must use a different strategy")
			result.should.containEql("Recommended approaches")
		})

		it("should tell model not to retry full write again", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.containEql("Do NOT attempt to write the full file content")
		})

		it("should not include CRITICAL language on second failure", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.not.containEql("CRITICAL")
		})
	})

	describe("third+ failure (tier 3)", () => {
		it("should include CRITICAL language on third failure", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3)
			result.should.containEql("CRITICAL")
			result.should.containEql("3 times in a row")
		})

		it("should tell model to NOT retry write_to_file", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3)
			result.should.containEql("do NOT retry write_to_file")
		})

		it("should include required action strategies", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3)
			result.should.containEql("Required action")
			result.should.containEql("replace_in_file")
			result.should.containEql("50-100 lines")
		})

		it("should show correct count for higher failure counts", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 5)
			result.should.containEql("5 times in a row")
		})
	})

	describe("context window awareness", () => {
		it("should include context warning when usage exceeds 50%", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1, 60)
			result.should.containEql("60% full")
			result.should.containEql("MUST use a strategy that produces smaller outputs")
		})

		it("should not include context warning when usage is 50% or below", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1, 50)
			result.should.not.containEql("% full")
		})

		it("should not include context warning when percent is undefined", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1, undefined)
			result.should.not.containEql("% full")
		})

		it("should show high context window usage correctly", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1, 85)
			result.should.containEql("85% full")
		})

		it("should include context warning in tier 3 messages", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3, 75)
			result.should.containEql("75% full")
			result.should.containEql("CRITICAL")
		})
	})
})
