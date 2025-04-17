import {
	insertMention,
	removeMention,
	getContextMenuOptions,
	shouldShowContextMenu,
	ContextMenuOptionType,
	ContextMenuQueryItem,
} from "../context-mentions"

describe("insertMention", () => {
	it("should insert mention at cursor position when no @ symbol exists", () => {
		const result = insertMention("Hello world", 5, "test")
		expect(result.newValue).toBe("Hello@test  world")
		expect(result.mentionIndex).toBe(5)
	})

	it("should replace text after last @ symbol", () => {
		const result = insertMention("Hello @wor world", 8, "test")
		expect(result.newValue).toBe("Hello @test  world")
		expect(result.mentionIndex).toBe(6)
	})

	it("should handle empty text", () => {
		const result = insertMention("", 0, "test")
		expect(result.newValue).toBe("@test ")
		expect(result.mentionIndex).toBe(0)
	})
})

describe("removeMention", () => {
	it("should remove mention when cursor is at end of mention", () => {
		// Test with the problems keyword that matches the regex
		const result = removeMention("Hello @problems ", 15)
		expect(result.newText).toBe("Hello ")
		expect(result.newPosition).toBe(6)
	})

	it("should not remove text when not at end of mention", () => {
		const result = removeMention("Hello @test world", 8)
		expect(result.newText).toBe("Hello @test world")
		expect(result.newPosition).toBe(8)
	})

	it("should handle text without mentions", () => {
		const result = removeMention("Hello world", 5)
		expect(result.newText).toBe("Hello world")
		expect(result.newPosition).toBe(5)
	})
})

describe("getContextMenuOptions", () => {
	const mockQueryItems: ContextMenuQueryItem[] = [
		{
			type: ContextMenuOptionType.File,
			value: "src/test.ts",
			label: "test.ts",
			description: "Source file",
		},
		{
			type: ContextMenuOptionType.OpenedFile,
			value: "src/opened.ts",
			label: "opened.ts",
			description: "Currently opened file",
		},
		{
			type: ContextMenuOptionType.Git,
			value: "abc1234",
			label: "Initial commit",
			description: "First commit",
			icon: "$(git-commit)",
		},
		{
			type: ContextMenuOptionType.Folder,
			value: "src",
			label: "src",
			description: "Source folder",
		},
	]

	const mockDynamicSearchResults = [
		{
			path: "search/result1.ts",
			type: "file" as const,
			label: "result1.ts",
		},
		{
			path: "search/folder",
			type: "folder" as const,
		},
	]

	it("should return all option types for empty query", () => {
		const result = getContextMenuOptions("", "", null, [])
		expect(result).toHaveLength(6)
		expect(result.map((item) => item.type)).toEqual([
			ContextMenuOptionType.Problems,
			ContextMenuOptionType.Terminal,
			ContextMenuOptionType.URL,
			ContextMenuOptionType.Folder,
			ContextMenuOptionType.File,
			ContextMenuOptionType.Git,
		])
	})

	it("should filter by selected type when query is empty", () => {
		const result = getContextMenuOptions("", "", ContextMenuOptionType.File, mockQueryItems)
		expect(result).toHaveLength(2)
		expect(result.map((item) => item.type)).toContain(ContextMenuOptionType.File)
		expect(result.map((item) => item.type)).toContain(ContextMenuOptionType.OpenedFile)
		expect(result.map((item) => item.value)).toContain("src/test.ts")
		expect(result.map((item) => item.value)).toContain("src/opened.ts")
	})

	it("should match git commands", () => {
		const result = getContextMenuOptions("git", "git", null, mockQueryItems)
		expect(result[0].type).toBe(ContextMenuOptionType.Git)
		expect(result[0].label).toBe("Git Commits")
	})

	it("should match git commit hashes", () => {
		const result = getContextMenuOptions("abc1234", "abc1234", null, mockQueryItems)
		expect(result[0].type).toBe(ContextMenuOptionType.Git)
		expect(result[0].value).toBe("abc1234")
	})

	it("should return NoResults when no matches found", () => {
		const result = getContextMenuOptions("nonexistent", "nonexistent", null, mockQueryItems)
		expect(result).toHaveLength(1)
		expect(result[0].type).toBe(ContextMenuOptionType.NoResults)
	})

	/**
	 * Tests for the combined handling of open files, git results, and search results
	 * Added for commit 3cd7dec78faf786e468ae4f66cef0b81a76d9075
	 */
	it("should include dynamic search results along with other matches", () => {
		// Add an opened file that will match the query
		const testItems = [
			...mockQueryItems,
			{
				type: ContextMenuOptionType.OpenedFile,
				value: "src/test-opened.ts",
				label: "test-opened.ts",
				description: "Opened test file for search test",
			},
		]

		const result = getContextMenuOptions("test", "test", null, testItems, mockDynamicSearchResults)

		// Check if opened files and dynamic search results are included
		expect(result.some((item) => item.type === ContextMenuOptionType.OpenedFile)).toBe(true)
		expect(result.some((item) => item.value === "/search/result1.ts")).toBe(true)
	})

	it("should maintain correct result ordering according to implementation", () => {
		// Add multiple item types to test ordering
		const result = getContextMenuOptions("t", "t", null, mockQueryItems, mockDynamicSearchResults)

		// Find the different result types
		const fileResults = result.filter(
			(item) =>
				item.type === ContextMenuOptionType.File ||
				item.type === ContextMenuOptionType.OpenedFile ||
				item.type === ContextMenuOptionType.Folder,
		)

		const searchResults = result.filter(
			(item) => item.type === ContextMenuOptionType.File && item.value?.includes("/search/"),
		)

		const gitResults = result.filter((item) => item.type === ContextMenuOptionType.Git)

		// Find the indexes of the first item of each type in the results array
		const firstFileIndex = result.findIndex((item) => fileResults.some((f) => f === item))

		const firstSearchResultIndex = result.findIndex((item) => searchResults.some((s) => s === item))

		const firstGitResultIndex = result.findIndex((item) => gitResults.some((g) => g === item))

		// Verify file results come before search results
		expect(firstFileIndex).toBeLessThan(firstSearchResultIndex)

		// Verify search results appear before git results
		expect(firstSearchResultIndex).toBeLessThan(firstGitResultIndex)
	})

	it("should include opened files when dynamic search results exist", () => {
		const result = getContextMenuOptions("open", "open", null, mockQueryItems, mockDynamicSearchResults)

		// Verify opened files are included
		expect(result.some((item) => item.type === ContextMenuOptionType.OpenedFile)).toBe(true)
		// Verify dynamic search results are also present
		expect(result.some((item) => item.value === "/search/result1.ts")).toBe(true)
	})

	it("should include git results when dynamic search results exist", () => {
		const result = getContextMenuOptions("commit", "commit", null, mockQueryItems, mockDynamicSearchResults)

		// Verify git results are included
		expect(result.some((item) => item.type === ContextMenuOptionType.Git)).toBe(true)
		// Verify dynamic search results are also present
		expect(result.some((item) => item.value === "/search/result1.ts")).toBe(true)
	})

	it("should deduplicate items correctly when combining different result types", () => {
		// Create duplicate search result with same path as an existing file
		const duplicateSearchResults = [
			{
				path: "src/test.ts", // Duplicate of existing file in mockQueryItems
				type: "file" as const,
			},
			{
				path: "unique/path.ts",
				type: "file" as const,
			},
		]

		const result = getContextMenuOptions("test", "test", null, mockQueryItems, duplicateSearchResults)

		// Count occurrences of src/test.ts in results
		const duplicateCount = result.filter(
			(item) =>
				(item.value === "src/test.ts" || item.value === "/src/test.ts") &&
				item.type === ContextMenuOptionType.File,
		).length
		// With path normalization, these should be treated as duplicates
		expect(duplicateCount).toBe(1)

		// Verify the unique item was included (check both path formats)
		expect(result.some((item) => item.value === "/unique/path.ts" || item.value === "unique/path.ts")).toBe(true)
	})

	it("should return NoResults when all combined results are empty with dynamic search", () => {
		// Use a query that won't match anything
		const result = getContextMenuOptions(
			"nonexistentquery123456",
			"nonexistentquery123456",
			null,
			mockQueryItems,
			[], // Empty dynamic search results
		)

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe(ContextMenuOptionType.NoResults)
	})

	/**
	 * Tests that opened files appear first in the results, according to the updated implementation
	 * This test validates the updated ordering where opened files have the highest priority
	 */
	it("should place opened files first in result order", () => {
		// Create test data with multiple types that should match the query
		const testQuery = "test" // Using "test" as the query to match all items

		const testItems: ContextMenuQueryItem[] = [
			{
				type: ContextMenuOptionType.File,
				value: "src/test-file.ts",
				label: "test-file.ts",
				description: "Regular test file",
			},
			{
				type: ContextMenuOptionType.OpenedFile,
				value: "src/test-opened.ts",
				label: "test-opened.ts",
				description: "Opened test file",
			},
			{
				type: ContextMenuOptionType.Git,
				value: "abctest",
				label: "Test commit",
				description: "Git test commit",
			},
		]

		const testSearchResults = [
			{
				path: "search/test-result.ts",
				type: "file" as const,
				label: "test-result.ts",
			},
		]

		// Get results for "test" query
		const result = getContextMenuOptions(testQuery, testQuery, null, testItems, testSearchResults)

		// Verify we have results
		expect(result.length).toBeGreaterThan(0)

		// Verify the first item is an opened file type
		expect(result[0].type).toBe(ContextMenuOptionType.OpenedFile)

		// Verify the remaining items are in the correct order:
		// suggestions -> openedFiles -> searchResults -> gitResults

		// Get index of first item of each type
		const firstOpenedFileIndex = result.findIndex((item) => item.type === ContextMenuOptionType.OpenedFile)
		const firstSearchResultIndex = result.findIndex(
			(item) => item.type === ContextMenuOptionType.File && item.value?.includes("/search/"),
		)
		const firstGitResultIndex = result.findIndex((item) => item.type === ContextMenuOptionType.Git)

		// Verify opened files come first
		expect(firstOpenedFileIndex).toBe(0)

		// Verify search results come after opened files but before git results
		expect(firstSearchResultIndex).toBeGreaterThan(firstOpenedFileIndex)

		// Verify git results come after search results
		if (firstGitResultIndex !== -1 && firstSearchResultIndex !== -1) {
			expect(firstGitResultIndex).toBeGreaterThan(firstSearchResultIndex)
		}
	})

	it("should process slash commands when both query and inputValue start with slash", () => {
		const mockModes = [
			{
				slug: "code",
				name: "Code",
				roleDefinition: "You are a coding assistant",
				groups: ["read" as const, "edit" as const],
			},
			{
				slug: "architect",
				name: "Architect",
				roleDefinition: "You are an architecture assistant",
				groups: ["read" as const],
			},
		]

		const result = getContextMenuOptions("/co", "/co", null, [], [], mockModes)

		// Verify mode results are returned
		expect(result[0].type).toBe(ContextMenuOptionType.Mode)
		expect(result[0].value).toBe("code")
	})

	it("should not process slash commands when query starts with slash but inputValue doesn't", () => {
		// Use a completely non-matching query to ensure we get NoResults
		// and provide empty query items to avoid any matches
		const result = getContextMenuOptions("/nonexistentquery", "Hello /code", null, [], [])

		// Should not process as a mode command
		expect(result[0].type).not.toBe(ContextMenuOptionType.Mode)
		// Should return NoResults since it won't match anything
		expect(result[0].type).toBe(ContextMenuOptionType.NoResults)
	})
})

describe("shouldShowContextMenu", () => {
	it("should return true for @ symbol", () => {
		expect(shouldShowContextMenu("@", 1)).toBe(true)
	})

	it("should return true for @ followed by text", () => {
		expect(shouldShowContextMenu("Hello @test", 10)).toBe(true)
	})

	it("should return false when no @ symbol exists", () => {
		expect(shouldShowContextMenu("Hello world", 5)).toBe(false)
	})

	it("should return false for @ followed by whitespace", () => {
		expect(shouldShowContextMenu("Hello @ world", 6)).toBe(false)
	})

	it("should return false for @ in URL", () => {
		expect(shouldShowContextMenu("Hello @http://test.com", 17)).toBe(false)
	})

	it("should return true for @problems", () => {
		// Position cursor at the end to test the full word
		expect(shouldShowContextMenu("@problems", 9)).toBe(true)
	})
})
