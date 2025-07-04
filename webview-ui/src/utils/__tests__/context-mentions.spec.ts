import {
	insertMention,
	removeMention,
	getContextMenuOptions,
	shouldShowContextMenu,
	ContextMenuOptionType,
	ContextMenuQueryItem,
	SearchResult,
} from "@src/utils/context-mentions"

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
	it("should replace partial mention after @", () => {
		const result = insertMention("Mention @fi", 11, "/path/to/file.txt") // Cursor after 'i'
		expect(result.newValue).toBe("Mention @/path/to/file.txt ") // Space added after mention
		expect(result.mentionIndex).toBe(8)
	})

	it("should add a space after the inserted mention", () => {
		const result = insertMention("Hello ", 6, "terminal") // Cursor at the end
		expect(result.newValue).toBe("Hello @terminal ")
		expect(result.mentionIndex).toBe(6)
	})

	it("should handle insertion at the beginning", () => {
		const result = insertMention("world", 0, "problems")
		expect(result.newValue).toBe("@problems world")
		expect(result.mentionIndex).toBe(0)
	})

	it("should handle insertion at the end", () => {
		const result = insertMention("Hello", 5, "problems")
		expect(result.newValue).toBe("Hello@problems ")
		expect(result.mentionIndex).toBe(5)
	})

	it("should handle slash command replacement", () => {
		const result = insertMention("/mode some", 5, "code") // Simulating mode selection
		expect(result.newValue).toBe("code") // Should replace the whole text
		expect(result.mentionIndex).toBe(0)
	})

	// --- Tests for Escaped Spaces ---
	it("should NOT escape spaces for non-path mentions", () => {
		const result = insertMention("Hello @abc ", 10, "git commit with spaces") // Not a path
		expect(result.newValue).toBe("Hello @git commit with spaces  ")
	})

	it("should escape spaces when inserting a file path mention with spaces", () => {
		const filePath = "/path/to/file with spaces.txt"
		const expectedEscapedPath = "/path/to/file\\ with\\ spaces.txt"
		const result = insertMention("Mention @old", 11, filePath)

		expect(result.newValue).toBe(`Mention @${expectedEscapedPath} `)
		expect(result.mentionIndex).toBe(8)
		// Verify escapeSpaces was effectively used (implicitly by checking output)
		expect(result.newValue).toContain("\\ ")
	})

	it("should escape spaces when inserting a folder path mention with spaces", () => {
		const folderPath = "/my documents/folder name/"
		const expectedEscapedPath = "/my\\ documents/folder\\ name/"
		const result = insertMention("Check @dir", 9, folderPath)

		expect(result.newValue).toBe(`Check @${expectedEscapedPath} `)
		expect(result.mentionIndex).toBe(6)
		expect(result.newValue).toContain("\\ ")
	})

	it("should NOT escape spaces if the path value already contains escaped spaces", () => {
		const alreadyEscapedPath = "/path/already\\ escaped.txt"
		const result = insertMention("Insert @path", 11, alreadyEscapedPath)

		// It should insert the already escaped path without double-escaping
		expect(result.newValue).toBe(`Insert @${alreadyEscapedPath} `)
		expect(result.mentionIndex).toBe(7)
		// Check that it wasn't passed through escapeSpaces again (mock check)
		// This relies on the mock implementation detail or careful checking
		// A better check might be ensuring no double backslashes appear unexpectedly.
		expect(result.newValue.includes("\\\\ ")).toBe(false)
	})

	it("should NOT escape spaces for paths without spaces", () => {
		const simplePath = "/path/to/file.txt"
		const result = insertMention("Simple @p", 9, simplePath)
		expect(result.newValue).toBe(`Simple @${simplePath} `)
		expect(result.mentionIndex).toBe(7)
		expect(result.newValue.includes("\\ ")).toBe(false)
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

	// --- Tests for Escaped Spaces ---
	it("should not remove mention with escaped spaces if cursor is at the end - KNOWN LIMITATION", () => {
		// NOTE: This is a known limitation - the current regex in removeMention
		// doesn't handle escaped spaces well because the regex engine needs
		// special lookbehind assertions for that.
		// For now, we're documenting this as a known limitation.
		const text = "File @/path/to/file\\ with\\ spaces.txt "
		const position = text.length // Cursor at the very end
		const { newText, newPosition } = removeMention(text, position)
		// The mention with escaped spaces won't be matched by the regex
		expect(newText).toBe(text)
		expect(newPosition).toBe(position)
	})

	it("should remove mention with escaped spaces and the following space", () => {
		const text = "File @/path/to/file\\ with\\ spaces.txt next word"
		const position = text.indexOf(" next") // Cursor right after the mention + space
		const { newText, newPosition } = removeMention(text, position)
		expect(newText).toBe("File next word")
		expect(newPosition).toBe(5)
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
			value: "src/open file.ts",
			label: "open file.ts",
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

	const mockSearchResults: SearchResult[] = [
		{ path: "/Users/test/project/src/search result spaces.ts", type: "file", label: "search result spaces.ts" },
		{ path: "/Users/test/project/assets/", type: "folder", label: "assets/" },
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
		expect(result.map((item) => item.value)).toContain("src/open file.ts")
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

	// --- Tests for Escaped Spaces (Focus on how paths are presented) ---
	it("should return search results with correct labels/descriptions (no escaping needed here)", () => {
		const options = getContextMenuOptions("@search", "search", null, mockQueryItems, mockSearchResults)
		const fileResult = options.find((o) => o.label === "search result spaces.ts")
		expect(fileResult).toBeDefined()
		// Value should be the normalized path, description might be the same or label
		expect(fileResult?.value).toBe("/Users/test/project/src/search result spaces.ts")
		expect(fileResult?.description).toBe("/Users/test/project/src/search result spaces.ts") // Check current implementation
		expect(fileResult?.label).toBe("search result spaces.ts")
		// Crucially, no backslashes should be in label/description here
		expect(fileResult?.label).not.toContain("\\")
		expect(fileResult?.description).not.toContain("\\")
	})

	it("should return query items (like opened files) with correct labels/descriptions", () => {
		const options = getContextMenuOptions("open", "@open", null, mockQueryItems, [])
		const openedFile = options.find((o) => o.label === "open file.ts")
		expect(openedFile).toBeDefined()
		expect(openedFile?.value).toBe("src/open file.ts")
		// Check label/description based on current implementation
		expect(openedFile?.label).toBe("open file.ts")
		// No backslashes expected in display values
		expect(openedFile?.label).not.toContain("\\")
	})

	it("should handle formatting of search results without escaping spaces in display", () => {
		// Create a search result with spaces in the path
		const searchResults: SearchResult[] = [
			{ path: "/path/with spaces/file.txt", type: "file", label: "file with spaces.txt" },
		]

		// The formatting happens in getContextMenuOptions when converting search results to menu items
		const formattedItems = getContextMenuOptions("spaces", "@spaces", null, [], searchResults)

		// Verify we get some results back that aren't "No Results"
		expect(formattedItems.length).toBeGreaterThan(0)
		expect(formattedItems[0].type !== ContextMenuOptionType.NoResults).toBeTruthy()

		// The main thing we want to verify is that no backslashes show up in any display fields
		// This is the core UI behavior we want to test - spaces should not be escaped in display text
		formattedItems.forEach((item) => {
			// Some items might not have labels or descriptions, so check conditionally
			if (item.label) {
				// Verify the label doesn't contain any escaped spaces
				expect(item.label.indexOf("\\")).toBe(-1)
			}
			if (item.description) {
				// Verify the description doesn't contain any escaped spaces
				expect(item.description.indexOf("\\")).toBe(-1)
			}
		})
	})

	// Add more tests for filtering, fuzzy search interaction if needed
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

	// --- Tests for Escaped Spaces ---
	it("should return true when typing path with escaped spaces", () => {
		expect(shouldShowContextMenu("@/path/to/file\\ ", 17)).toBe(true) // Cursor after escaped space
		expect(shouldShowContextMenu("@/path/to/file\\ with\\ spaces", 28)).toBe(true) // Cursor within path after escaped spaces
	})

	it("should return false if an unescaped space exists after @", () => {
		// This case means the regex wouldn't match anyway, but confirms context menu logic
		expect(shouldShowContextMenu("@/path/with space", 13)).toBe(false) // Cursor after unescaped space
	})
})
