import { mentionRegex, mentionRegexGlobal } from "../context-mentions"

describe("mentionRegex and mentionRegexGlobal", () => {
	// Test cases for various mention types
	const testCases = [
		// Basic file paths
		{ input: "@/path/to/file.txt", expected: ["@/path/to/file.txt"] },
		{ input: "@/file.js", expected: ["@/file.js"] },
		{ input: "@/folder/", expected: ["@/folder/"] },

		// File paths with escaped spaces
		{ input: "@/path/to/file\\ with\\ spaces.txt", expected: ["@/path/to/file\\ with\\ spaces.txt"] },
		{ input: "@/users/my\\ project/report\\ final.pdf", expected: ["@/users/my\\ project/report\\ final.pdf"] },
		{ input: "@/folder\\ with\\ spaces/", expected: ["@/folder\\ with\\ spaces/"] },
		{ input: "@/a\\ b\\ c.txt", expected: ["@/a\\ b\\ c.txt"] },

		// URLs
		{ input: "@http://example.com", expected: ["@http://example.com"] },
		{ input: "@https://example.com/path?query=1", expected: ["@https://example.com/path?query=1"] },

		// Other mentions
		{ input: "@problems", expected: ["@problems"] },
		{ input: "@git-changes", expected: ["@git-changes"] },
		{ input: "@terminal", expected: ["@terminal"] },
		{ input: "@a1b2c3d", expected: ["@a1b2c3d"] }, // Git commit hash (short)
		{ input: "@a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", expected: ["@a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"] }, // Git commit hash (long)

		// Mentions within text
		{
			input: "Check file @/path/to/file\\ with\\ spaces.txt for details.",
			expected: ["@/path/to/file\\ with\\ spaces.txt"],
		},
		{ input: "See @problems and @terminal output.", expected: ["@problems", "@terminal"] },
		{ input: "URL: @https://example.com.", expected: ["@https://example.com"] }, // Trailing punctuation
		{ input: "Commit @a1b2c3d, then check @/file.txt", expected: ["@a1b2c3d", "@/file.txt"] },

		// Negative cases (should not match or match partially)
		{ input: "@/path/with unescaped space.txt", expected: ["@/path/with"] }, // Unescaped space
		{ input: "@ /path/leading-space.txt", expected: null }, // Space after @
		{ input: "email@example.com", expected: null }, // Email address
		{ input: "mention@", expected: null }, // Trailing @
		{ input: "@/path/trailing\\", expected: null }, // Trailing backslash (invalid escape)
		{ input: "@/path/to/file\\not-a-space", expected: null }, // Backslash not followed by space
		// Escaped mentions (should not match due to negative lookbehind)
		{ input: "This is not a mention: \\@/path/to/file.txt", expected: null },
		{ input: "Escaped \\@problems word", expected: null },
		{ input: "Text with \\@https://example.com", expected: null },
		{ input: "Another \\@a1b2c3d hash", expected: null },
		{ input: "Not escaped @terminal", expected: ["@terminal"] }, // Ensure non-escaped still works nearby
		{ input: "Double escape \\\\@/should/match", expected: null }, // Double backslash escapes the backslash, currently incorrectly fails to match
		{ input: "Text with \\@/escaped/path\\ with\\ spaces.txt", expected: null }, // Escaped mention with escaped spaces within the path part
	]
	testCases.forEach(({ input, expected }) => {
		it(`should handle input: "${input}"`, () => {
			// Test mentionRegex (first match)
			const match = input.match(mentionRegex)
			const firstExpected = expected ? expected[0] : null
			if (firstExpected) {
				expect(match).not.toBeNull()
				// Check the full match (group 0)
				expect(match?.[0]).toBe(firstExpected)
				// Check the captured group (group 1) - remove leading '@'
				expect(match?.[1]).toBe(firstExpected.slice(1))
			} else {
				expect(match).toBeNull()
			}

			// Test mentionRegexGlobal (all matches)
			const globalMatches = Array.from(input.matchAll(mentionRegexGlobal)).map((m) => m[0])
			if (expected) {
				expect(globalMatches).toEqual(expected)
			} else {
				expect(globalMatches).toEqual([])
			}
		})
	})

	it("should correctly capture the mention part (group 1)", () => {
		const input = "Mention @/path/to/escaped\\ file.txt and @problems"
		const matches = Array.from(input.matchAll(mentionRegexGlobal))

		expect(matches.length).toBe(2)
		expect(matches[0][1]).toBe("/path/to/escaped\\ file.txt") // Group 1 should not include '@'
		expect(matches[1][1]).toBe("problems")
	})
})
