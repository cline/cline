import { describe, it } from "mocha"
import "should"
import type { ClineContent } from "@shared/messages/content"
import { extractUserPromptFromContent } from "../extractUserPromptFromContent"

describe("extractUserPromptFromContent", () => {
	describe("New Task Scenario", () => {
		it("should extract content from <task> tags", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\nfix the login bug\n</task>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("fix the login bug")
		})

		it("should handle multiline task content", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\nCreate a new component\nAdd tests\nUpdate documentation\n</task>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Create a new component\nAdd tests\nUpdate documentation")
		})
	})

	describe("Resume Task Scenario", () => {
		it("should skip system [TASK RESUMPTION] messages", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "[TASK RESUMPTION] This task was interrupted 5 minutes ago...",
				},
				{
					type: "text",
					text: "<feedback>\nContinue with the implementation\n</feedback>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Continue with the implementation")
		})

		it("should skip hook context blocks", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: '<hook_context source="TaskResume">\nSome context info\n</hook_context>',
				},
				{
					type: "text",
					text: "fix the bug",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("fix the bug")
		})

		it("should handle complex resume scenario with multiple blocks", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: '<hook_context source="TaskResume" type="general">\nContext from hook\n</hook_context>',
				},
				{
					type: "text",
					text: "[TASK RESUMPTION] This task was interrupted 2 days ago. It may or may not be complete...",
				},
				{
					type: "text",
					text: "<feedback>\nPlease complete the feature\n</feedback>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Please complete the feature")
		})
	})

	describe("Feedback After Completion Scenario", () => {
		it("should extract content from <feedback> tags", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<feedback>\nActually, please add error handling\n</feedback>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Actually, please add error handling")
		})

		it("should handle feedback with hook context", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<feedback>\nAdd more tests\n</feedback>",
				},
				{
					type: "text",
					text: '<hook_context source="UserPromptSubmit">\nAdditional context\n</hook_context>',
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Add more tests")
		})
	})

	describe("Image Handling", () => {
		it("should preserve images as [IMAGE] placeholders", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\nAnalyze this screenshot\n</task>",
				},
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "...",
					},
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Analyze this screenshot\n\n[IMAGE]")
		})

		it("should handle multiple images", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\nCompare these images\n</task>",
				},
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "...",
					},
				},
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "...",
					},
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Compare these images\n\n[IMAGE]\n\n[IMAGE]")
		})
	})

	describe("Edge Cases", () => {
		it("should handle empty content array", () => {
			const content: ClineContent[] = []
			const result = extractUserPromptFromContent(content)
			result.should.equal("")
		})

		it("should handle resume with no user text (only system messages)", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "[TASK RESUMPTION] This task was interrupted 1 hour ago...",
				},
				{
					type: "text",
					text: "Your response was not provided.",
				},
			]
			const result = extractUserPromptFromContent(content)
			result.should.equal("Your response was not provided.")
		})

		it("should return empty string when only system content present", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "[TASK RESUMPTION] This task was interrupted 1 hour ago.",
				},
				{
					type: "text",
					text: '<hook_context source="TaskResume">\nSome context\n</hook_context>',
				},
			]
			const result = extractUserPromptFromContent(content)
			result.should.equal("")
		})

		it("should return empty string when resuming with empty feedback", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: '<hook_context source="TaskResume">\nContext\n</hook_context>',
				},
				{
					type: "text",
					text: "[TASK RESUMPTION] Task was interrupted...",
				},
				{
					type: "text",
					text: "<feedback>\n\n</feedback>",
				},
			]
			const result = extractUserPromptFromContent(content)
			result.should.equal("")
		})

		it("should handle content with only whitespace", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\n   \n</task>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("")
		})

		it("should handle malformed tags gracefully", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>Valid content",
				},
			]

			const result = extractUserPromptFromContent(content)
			// Should return empty since tag is not properly closed
			result.should.equal("")
		})

		it("should handle plain text without any tags", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "Just some plain user text",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Just some plain user text")
		})

		it("should handle <answer> tags from followup questions", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<answer>\nYes, proceed with the changes\n</answer>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Yes, proceed with the changes")
		})

		it("should handle <user_message> tags", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<user_message>\nPlease review this\n</user_message>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Please review this")
		})
	})

	describe("Multiple User Content Blocks", () => {
		it("should combine multiple user content sections", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\nFirst part of the task\n</task>",
				},
				{
					type: "text",
					text: "<feedback>\nAdditional requirements\n</feedback>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("First part of the task\n\nAdditional requirements")
		})

		it("should handle mixed tagged and untagged content", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "<task>\nMain task\n</task>",
				},
				{
					type: "text",
					text: "Additional note",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Main task\n\nAdditional note")
		})
	})

	describe("System Content Filtering", () => {
		it("should filter out interrupted task messages", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "[Response interrupted by user feedback]",
				},
				{
					type: "text",
					text: "<feedback>\nActual user feedback\n</feedback>",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("Actual user feedback")
		})

		it("should filter out task interruption notices", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "Task was interrupted before this tool call could be completed.",
				},
				{
					type: "text",
					text: "fix the issue",
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal("fix the issue")
		})
	})

	describe("Consistency Across Scenarios", () => {
		const userInput = "implement the authentication feature"

		it("should produce same output for new task", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: `<task>\n${userInput}\n</task>`,
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal(userInput)
		})

		it("should produce same output for resume with feedback", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: "[TASK RESUMPTION] This task was interrupted 1 hour ago...",
				},
				{
					type: "text",
					text: `<feedback>\n${userInput}\n</feedback>`,
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal(userInput)
		})

		it("should produce same output for post-completion feedback", () => {
			const content: ClineContent[] = [
				{
					type: "text",
					text: `<feedback>\n${userInput}\n</feedback>`,
				},
			]

			const result = extractUserPromptFromContent(content)
			result.should.equal(userInput)
		})
	})
})
