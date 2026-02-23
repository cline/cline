import { expect } from "chai"

import { mentionRegex, mentionRegexGlobal } from "../context-mentions"

interface TestResult {
	actual: string | null
	expected: string | null
}

function testMention(input: string, expected: string | null): TestResult {
	const match = mentionRegex.exec(input)
	return {
		actual: match ? match[0] : null,
		expected,
	}
}

function assertMatch(result: TestResult) {
	expect(result.actual).eq(result.expected)
	return true
}

describe("Mention Regex", () => {
	describe("Windows Path Support", () => {
		it("matches simple Windows paths", () => {
			const cases: Array<[string, string]> = [
				["@/C:\\folder\\file.txt", "@/C:\\folder\\file.txt"],
				["@/C:\\file.txt", "@/C:\\file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})
	})

	describe("Edge Cases", () => {
		it("handles edge cases correctly", () => {
			const cases: Array<[string, string]> = [
				["@/C:\\Users\\name\\path\\to\\文件夹\\file.txt", "@/C:\\Users\\name\\path\\to\\文件夹\\file.txt"],
				["@/path123/file-name_2.0.txt", "@/path123/file-name_2.0.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})
		it("handles unquoted paths with spaces correctly", () => {
			// Should stop at the space
			const match = mentionRegex.exec("@/path with spaces/file.txt")
			expect(match?.[0]).to.equal("@/path")
		})
	})

	describe("Existing Functionality", () => {
		it("matches Unix paths", () => {
			const cases: Array<[string, string]> = [
				["@/usr/local/bin/file", "@/usr/local/bin/file"],
				["@/path/to/file.txt", "@/path/to/file.txt"],
				["@//etc/host", "@//etc/host"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})

		it("matches URLs", () => {
			const cases: Array<[string, string]> = [
				["@http://example.com", "@http://example.com"],
				["@https://example.com/path/to/file.html", "@https://example.com/path/to/file.html"],
				["@ftp://server.example.com/file.zip", "@ftp://server.example.com/file.zip"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})

		it("matches git hashes", () => {
			const cases: Array<[string, string]> = [
				["@abcdef1234567890abcdef1234567890abcdef12", "@abcdef1234567890abcdef1234567890abcdef12"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})

		it("matches special keywords", () => {
			const cases: Array<[string, string]> = [
				["@problems", "@problems"],
				["@git-changes", "@git-changes"],
				["@terminal", "@terminal"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})
	})

	describe("Invalid Patterns", () => {
		it("rejects invalid patterns", () => {
			const cases: Array<[string, null]> = [
				["C:\\folder\\file.txt", null],
				["@", null],
				["@ C:\\file.txt", null],
				["@'/path/file.tar.gz'", null],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})

		it("matches only until invalid characters", () => {
			const result = testMention("@/C:\\folder\\file.txt invalid suffix", "@/C:\\folder\\file.txt")
			assertMatch(result)
		})
	})

	describe("In Context", () => {
		it("matches mentions within text", () => {
			const cases: Array<[string, string]> = [
				["Check the file at @/C:\\folder\\file.txt for details.", "@/C:\\folder\\file.txt"],
				["Review @problems and @git-changes.", "@problems"],
				["Multiple: @/file1.txt and @/C:\\file2.txt and @terminal", "@/file1.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})
	})

	describe("Multiple Mentions", () => {
		it("finds all mentions in a string using global regex", () => {
			const text = "Check @/path/file1.txt and @/C:\\folder\\file2.txt and report any @problems to @git-changes"
			const matches = text.match(mentionRegexGlobal)
			expect(matches).deep.eq(["@/path/file1.txt", "@/C:\\folder\\file2.txt", "@problems", "@git-changes"])
		})
	})

	describe("Special Characters in Paths", () => {
		it("handles special characters in file paths", () => {
			const cases: Array<[string, string]> = [
				["@/path/with-dash/file_underscore.txt", "@/path/with-dash/file_underscore.txt"],
				["@/C:\\folder+plus\\file(parens)[]brackets.txt", "@/C:\\folder+plus\\file(parens)[]brackets.txt"],
				["@/path/with/file#hash%percent.txt", "@/path/with/file#hash%percent.txt"],
				["@/path/with/file@symbol$dollar.txt", "@/path/with/file@symbol$dollar.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})
	})

	describe("Mixed Path Types in Single String", () => {
		it("correctly identifies the first path in a string with multiple path types", () => {
			const text = "Check both @/unix/path and @/C:\\windows\\path for details."
			const result = mentionRegex.exec(text) || []
			expect(result[0]).eq("@/unix/path")

			// Test starting from after the first match
			const secondSearchStart = text.indexOf("@/C:")
			const secondResult = mentionRegex.exec(text.substring(secondSearchStart)) || []
			expect(secondResult[0]).eq("@/C:\\windows\\path")
		})
	})

	describe("Non-Latin Character Support", () => {
		it("handles international characters in paths", () => {
			const cases: Array<[string, string]> = [
				["@/path/to/你好/file.txt", "@/path/to/你好/file.txt"],
				["@/C:\\用户\\документы\\файл.txt", "@/C:\\用户\\документы\\файл.txt"],
				["@/путь/к/файлу.txt", "@/путь/к/файлу.txt"],
				["@/C:\\folder\\file_äöü.txt", "@/C:\\folder\\file_äöü.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				assertMatch(result)
			})
		})
	})
	describe("Git Hash Edge Cases", () => {
		it("matches git hashes of various valid lengths", () => {
			const cases: Array<[string, string | null]> = [
				// Valid lengths (7-40 characters)
				["@abcdef1", "@abcdef1"], // 7 chars (minimum)
				["@abcdef12", "@abcdef12"], // 8 chars
				["@abcdef1234567890", "@abcdef1234567890"], // 16 chars
				["@abcdef1234567890abcdef1234567890abcdef12", "@abcdef1234567890abcdef1234567890abcdef12"], // 40 chars (maximum)

				// Invalid lengths
				["@abcdef", null], // 6 chars (too short)
				["@abcdef1234567890abcdef1234567890abcdef123", null], // 41 chars (too long, but would match first 40)

				// Invalid characters
				["@ghijklm", null], // Contains non-hex characters
				["@ABCDEF1", null], // Uppercase not allowed
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				const actual = match ? match[0] : null
				if (expected && expected.includes("41 chars")) {
					// Special case: should match first 40 chars
					expect(actual).to.equal("@abcdef1234567890abcdef1234567890abcdef12")
				} else {
					expect(actual).to.equal(expected)
				}
			})
		})
	})

	describe("Punctuation at Boundaries", () => {
		it("excludes all types of trailing punctuation", () => {
			const cases: Array<[string, string]> = [
				["@/path/file.txt.", "@/path/file.txt"],
				["@problems:", "@problems"],
				["@terminal;", "@terminal"],
				["@/path/file.txt!", "@/path/file.txt"],
				["@/path/file.txt?", "@/path/file.txt"],
				["@git-changes,", "@git-changes"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})

		it("handles multiple punctuation marks", () => {
			const cases: Array<[string, string]> = [
				["@/path/file.txt!?", "@/path/file.txt"],
				["@problems...", "@problems"],
				["@terminal!!", "@terminal"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})

		it("doesn't match trailing punctuation in context", () => {
			const cases: Array<[string, string[]]> = [
				["Check the file at @/C:\\folder\\file.txt! for details.", ["@/C:\\folder\\file.txt"]],
				["Review @problems, and @git-changes.", ["@problems", "@git-changes"]],
				["Multiple: @/file1.txt, and @/C:\\file2.txt; and @terminal?", ["@/file1.txt", "@/C:\\file2.txt", "@terminal"]],
			]

			cases.forEach(([input, expected]) => {
				const matches = input.match(mentionRegexGlobal)
				expect(matches).deep.eq(expected)
			})
		})
	})

	describe("URL Protocol Variations", () => {
		it("matches various URL protocols", () => {
			const cases: Array<[string, string]> = [
				["@file://localhost/path/to/file", "@file://localhost/path/to/file"],
				["@custom://app/resource", "@custom://app/resource"],
				["@app://settings", "@app://settings"],
				["@ssh://git@github.com/repo", "@ssh://git@github.com/repo"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})

		it("matches URLs with complex structures", () => {
			const cases: Array<[string, string]> = [
				["@https://example.com?q=test&p=1", "@https://example.com?q=test&p=1"],
				["@https://example.com#section", "@https://example.com#section"],
				["@http://localhost:3000", "@http://localhost:3000"],
				["@https://user:pass@example.com", "@https://user:pass@example.com"],
				["@https://example.com/", "@https://example.com/"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
	})

	describe("End of String Handling", () => {
		it("matches mentions at end of string", () => {
			const cases: Array<[string, string]> = [
				["Check @/path/file.txt", "@/path/file.txt"],
				["Review @problems", "@problems"],
				["Open @terminal", "@terminal"],
				["See @git-changes", "@git-changes"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
	})

	describe("Complex Real-World Scenarios", () => {
		it("handles mentions in markdown-like text", () => {
			const text = "See @/docs/README.md, check @problems, and visit @https://example.com."
			const matches = text.match(mentionRegexGlobal)
			expect(matches).to.deep.equal(["@/docs/README.md", "@problems", "@https://example.com"])
		})

		it("handles mentions in code comments", () => {
			const text = "// TODO: Fix @problems in @/src/index.js (see @git-changes)"
			const matches = text.match(mentionRegexGlobal)
			expect(matches).to.deep.equal(["@problems", "@/src/index.js", "@git-changes"])
		})
	})
	describe("Quoted file paths", () => {
		it("handles quoted paths correctly", () => {
			const cases: Array<[string, string]> = [
				['@"/path with space.txt"', '@"/path with space.txt"'],
				['@"/path/ends/with-space "', '@"/path/ends/with-space "'],
				['@"/ path-starts-with-space.txt"', '@"/ path-starts-with-space.txt"'],
				['@"/path with space.txt!"', '@"/path with space.txt!"'],
				['@"/path with space.txt!"!', '@"/path with space.txt!"'],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
		it("handles quotes inside file paths correctly", () => {
			const cases: Array<[string, string]> = [
				['@/"path/file.txt', '@/"path/file.txt'],
				['@/path"/file".tar.gz', '@/path"/file".tar.gz'],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
	})
	describe("Path Edge Cases", () => {
		it("matches various path structures", () => {
			const cases: Array<[string, string]> = [
				["@/", "@/"], // root directory
				['@"/"', '@"/"'], // quoted root directory
				["@/path/to/.hidden/file", "@/path/to/.hidden/file"],
				["@/path/file...txt", "@/path/file...txt"],
				["@/path/file.tar.gz", "@/path/file.tar.gz"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
	})
	describe("Whitespace Handling", () => {
		it("stops at various whitespace characters", () => {
			const cases: Array<[string, string]> = [
				["@/path/file.txt\trest", "@/path/file.txt"],
				["@/path/file.txt\nrest", "@/path/file.txt"],
				["@/path/file.txt\rrest", "@/path/file.txt"],
				["@/path/file.txt rest", "@/path/file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
	})

	describe("Keyword Boundaries", () => {
		it("only matches exact keywords", () => {
			const cases: Array<[string, string | null]> = [
				["@problemsolver", null], // Should not match
				["@terminals", null], // Should not match
				["@git-changeset", null], // Should not match
				["@problem", null], // Should not match
				["@git-change", null], // Should not match
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				const actual = match ? match[0] : null
				expect(actual).to.equal(expected)
			})
		})

		it("matches keywords with trailing punctuation", () => {
			const cases: Array<[string, string]> = [
				["@problems!", "@problems"],
				["@terminal.", "@terminal"],
				["@git-changes,", "@git-changes"],
			]

			cases.forEach(([input, expected]) => {
				const match = mentionRegex.exec(input)
				expect(match?.[0]).to.equal(expected)
			})
		})
	})
})
