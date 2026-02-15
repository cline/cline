import { describe, it } from "mocha"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse.writeToFileMissingContentError", () => {
	it("should include the file path in the error message", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts")
		result.should.containEql("src/index.ts")
	})

	it("should include the base error explanation", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts")
		result.should.containEql("'content' parameter was empty")
		result.should.containEql("output token limits")
	})

	it("should include helpful suggestions", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts")
		result.should.containEql("Suggestions")
		result.should.containEql("replace_in_file")
		result.should.containEql("skeleton")
	})

	it("should include the tool use instructions reminder", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts")
		result.should.containEql("Reminder: Instructions for Tool Use")
	})

	it("should mention breaking down the task into smaller steps", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts")
		result.should.containEql("breaking down the task into smaller steps")
	})

	it("should suggest using replace_in_file for existing files", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts")
		result.should.containEql("prefer replace_in_file to make targeted edits")
	})

	it("should work with different file paths", () => {
		const result = formatResponse.writeToFileMissingContentError("components/MyComponent.tsx")
		result.should.containEql("components/MyComponent.tsx")
	})

	// Context window awareness tests
	it("should include context window usage note when percent is provided", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts", 60)
		result.should.containEql("Context window is 60% full")
		result.should.containEql("Keep responses concise")
	})

	it("should not include context window note when percent is undefined", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts", undefined)
		result.should.not.containEql("Context window is")
	})

	it("should not include context window note when percent is 0", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts", 0)
		result.should.not.containEql("Context window is")
	})

	it("should show high context window usage correctly", () => {
		const result = formatResponse.writeToFileMissingContentError("src/index.ts", 85)
		result.should.containEql("Context window is 85% full")
	})
})
