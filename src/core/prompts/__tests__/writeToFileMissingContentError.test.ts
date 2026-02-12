import { describe, it } from "mocha"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse.writeToFileMissingContentError", () => {
	describe("first failure (consecutiveFailures = 1)", () => {
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

		it("should NOT include context warning when no context usage provided", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1)
			result.should.not.containEql("Context window is")
		})

		it("should NOT include context warning when usage is below 50%", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1, 30)
			result.should.not.containEql("Context window is")
		})

		it("should include context warning when usage is above 50%", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 1, 75)
			result.should.containEql("Context window is 75% full")
			result.should.containEql("MUST use a strategy that produces smaller outputs")
		})
	})

	describe("second failure (consecutiveFailures = 2)", () => {
		it("should use stronger language about changing strategy", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.containEql("2nd failed attempt")
			result.should.containEql("must use a different strategy")
		})

		it("should recommend specific alternative approaches", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.containEql("minimal skeleton")
			result.should.containEql("replace_in_file with smaller chunks")
			result.should.containEql("Break the task into smaller steps")
		})

		it("should explicitly tell the model not to retry write_to_file", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.containEql("Do NOT attempt to write the full file content in a single write_to_file call again")
		})

		it("should NOT include the generic tool use instructions reminder", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2)
			result.should.not.containEql("Reminder: Instructions for Tool Use")
		})

		it("should include context warning at high usage", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 2, 85)
			result.should.containEql("Context window is 85% full")
		})
	})

	describe("third+ failure (consecutiveFailures >= 3)", () => {
		it("should use CRITICAL language", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3)
			result.should.containEql("CRITICAL")
			result.should.containEql("failed to write this file 3 times in a row")
		})

		it("should tell the model to STOP using write_to_file", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3)
			result.should.containEql("MUST change your approach")
			result.should.containEql("do NOT retry write_to_file")
		})

		it("should provide concrete required actions", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3)
			result.should.containEql("Create an empty file first, then use replace_in_file")
			result.should.containEql("50-100 lines")
		})

		it("should work for 4+ failures with updated count", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 5)
			result.should.containEql("failed to write this file 5 times in a row")
			result.should.containEql("CRITICAL")
		})

		it("should include context warning at high usage", () => {
			const result = formatResponse.writeToFileMissingContentError("src/index.ts", 3, 92)
			result.should.containEql("Context window is 92% full")
		})
	})

	describe("progressive escalation", () => {
		it("should produce increasingly directive messages as failures increase", () => {
			const msg1 = formatResponse.writeToFileMissingContentError("file.ts", 1)
			const msg2 = formatResponse.writeToFileMissingContentError("file.ts", 2)
			const msg3 = formatResponse.writeToFileMissingContentError("file.ts", 3)

			// First message should have suggestions (soft guidance)
			msg1.should.containEql("Suggestions")
			msg1.should.not.containEql("CRITICAL")

			// Second message should have stronger language
			msg2.should.containEql("Do NOT attempt")
			msg2.should.not.containEql("CRITICAL")

			// Third message should be the most directive
			msg3.should.containEql("CRITICAL")
			msg3.should.containEql("MUST change your approach")
		})
	})

	describe("context window awareness", () => {
		it("should not show warning at exactly 50%", () => {
			const result = formatResponse.writeToFileMissingContentError("file.ts", 1, 50)
			result.should.not.containEql("Context window is")
		})

		it("should show warning at 51%", () => {
			const result = formatResponse.writeToFileMissingContentError("file.ts", 1, 51)
			result.should.containEql("Context window is 51% full")
		})

		it("should show warning at 100%", () => {
			const result = formatResponse.writeToFileMissingContentError("file.ts", 1, 100)
			result.should.containEql("Context window is 100% full")
		})

		it("should handle undefined context usage gracefully", () => {
			const result = formatResponse.writeToFileMissingContentError("file.ts", 1, undefined)
			result.should.not.containEql("Context window is")
		})
	})
})
