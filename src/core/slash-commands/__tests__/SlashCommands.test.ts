import { parseSlashCommands } from "../index"
import { newTaskToolResponse } from "../../prompts/commands"
import { expect } from "chai"

describe("SlashCommands", () => {
	describe("parseSlashCommands", () => {
		it("should replace /newtask command with appropriate instructions", () => {
			// Input text with slash command
			const inputText = "<task>/newtask Build a website</task>"

			// Expected result - command replaced with instructions from newTaskToolResponse
			// While keeping original tag and content after the command
			const expectedOutput = newTaskToolResponse() + "<task> Build a website</task>"

			// Run function
			const result = parseSlashCommands(inputText)

			// Verify result
			expect(result).to.equal(expectedOutput)
		})

		it("should return original text when no supported commands are found", () => {
			// Input text without slash command
			const inputText = "<task>Build a website</task>"

			// Expected result is unchanged
			const expectedOutput = inputText

			// Run function
			const result = parseSlashCommands(inputText)

			// Verify result
			expect(result).to.equal(expectedOutput)
		})

		// Test for handling slash commands in different tag types
		it("should handle slash commands in various tag types", () => {
			// Input text with slash command in feedback tag
			const inputText = "<feedback>/newtask Continue with the project</feedback>"

			// Expected result
			const expectedOutput = newTaskToolResponse() + "<feedback> Continue with the project</feedback>"

			// Run function
			const result = parseSlashCommands(inputText)

			// Verify result
			expect(result).to.equal(expectedOutput)
		})

		// Test for handling whitespace around the slash command
		it("should handle whitespace around slash commands", () => {
			// Input text with whitespace before command
			const inputText = "<task>   /newtask Build a website</task>"

			// Expected result
			const expectedOutput = newTaskToolResponse() + "<task> Build a website</task>"

			// Run function
			const result = parseSlashCommands(inputText)

			// Verify result
			expect(result).to.equal(expectedOutput)
		})
	})
})
