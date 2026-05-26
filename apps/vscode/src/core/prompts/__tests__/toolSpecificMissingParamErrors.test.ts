import { describe, it } from "mocha"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse.replaceInFileMissingDiffError", () => {
	it("should include the file path in the error message", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.containEql("src/index.ts")
	})

	it("should mention that the diff parameter was empty", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.containEql("'diff' parameter was empty")
	})

	it("should include the SEARCH/REPLACE block format", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.containEql("<<<<<<< SEARCH")
		result.should.containEql("=======")
		result.should.containEql(">>>>>>> REPLACE")
	})

	it("should include rules about exact matching", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.containEql("match existing file content exactly")
	})

	it("should suggest using read_file if unsure", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.containEql("read_file")
	})

	it("should NOT include the generic toolUseInstructionsReminder", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.not.containEql("Reminder: Instructions for Tool Use")
	})

	it("should work with different file paths", () => {
		const result = formatResponse.replaceInFileMissingDiffError("components/App.tsx")
		result.should.containEql("components/App.tsx")
	})
})

describe("formatResponse.executeCommandMissingCommandError", () => {
	it("should mention that the command parameter was empty", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.containEql("'command' parameter was empty")
	})

	it("should include a concrete XML example", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.containEql("<execute_command>")
		result.should.containEql("<command>")
		result.should.containEql("</command>")
		result.should.containEql("</execute_command>")
	})

	it("should include requires_approval in the example", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.containEql("<requires_approval>")
	})

	it("should NOT include the generic toolUseInstructionsReminder", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.not.containEql("Reminder: Instructions for Tool Use")
	})
})
