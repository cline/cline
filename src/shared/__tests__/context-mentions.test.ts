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
})
