import { describe, expect, it } from "vitest"
import { insertMention, insertMentionDirectly } from "../context-mentions"

describe("context-mentions", () => {
	describe("insertMention", () => {
		it("should add quotes to file paths with spaces", () => {
			const text = "Check @"
			const position = 7
			const value = "/path with spaces/file.txt"

			const result = insertMention(text, position, value)

			expect(result.newValue).toBe('Check @"/path with spaces/file.txt" ')
			expect(result.mentionIndex).toBe(6)
		})

		it("should not add quotes to file paths without spaces", () => {
			const text = "Check @"
			const position = 7
			const value = "/path/without/spaces.txt"

			const result = insertMention(text, position, value)

			expect(result.newValue).toBe("Check @/path/without/spaces.txt ")
			expect(result.mentionIndex).toBe(6)
		})

		it("should not add quotes to non-file mentions", () => {
			const text = "Check @"
			const position = 7
			const value = "terminal"

			const result = insertMention(text, position, value)

			expect(result.newValue).toBe("Check @terminal ")
			expect(result.mentionIndex).toBe(6)
		})

		it("should replace existing partial mention", () => {
			const text = "Check @/pa and more"
			const position = 10
			const value = "/path with spaces/file.txt"

			const result = insertMention(text, position, value)

			expect(result.newValue).toBe('Check @"/path with spaces/file.txt"  and more')
			expect(result.mentionIndex).toBe(6)
		})

		it("should handle folder paths with spaces", () => {
			const text = "Look in @"
			const position = 9
			const value = "/folder with spaces/"

			const result = insertMention(text, position, value)

			expect(result.newValue).toBe('Look in @"/folder with spaces/" ')
			expect(result.mentionIndex).toBe(8)
		})
	})

	describe("insertMentionDirectly", () => {
		it("should add quotes to file paths with spaces", () => {
			const text = "Some text "
			const position = 10
			const value = "/folder with spaces/"

			const result = insertMentionDirectly(text, position, value)

			expect(result.newValue).toBe('Some text @"/folder with spaces/" ')
			expect(result.mentionIndex).toBe(10)
		})

		it("should not add quotes to file paths without spaces", () => {
			const text = "Some text "
			const position = 10
			const value = "/folder/without/spaces/"

			const result = insertMentionDirectly(text, position, value)

			expect(result.newValue).toBe("Some text @/folder/without/spaces/ ")
			expect(result.mentionIndex).toBe(10)
		})

		it("should handle URLs without adding quotes", () => {
			const text = "Visit "
			const position = 6
			const value = "https://example.com"

			const result = insertMentionDirectly(text, position, value)

			expect(result.newValue).toBe("Visit @https://example.com ")
			expect(result.mentionIndex).toBe(6)
		})

		it("should handle special mentions without adding quotes", () => {
			const text = "Check "
			const position = 6
			const value = "git-changes"

			const result = insertMentionDirectly(text, position, value)

			expect(result.newValue).toBe("Check @git-changes ")
			expect(result.mentionIndex).toBe(6)
		})
	})
})
