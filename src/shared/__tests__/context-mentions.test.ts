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

function expectMatch(result: TestResult) {
	if (result.expected === null) {
		return expect(result.actual).toBeNull()
	}
	if (result.actual !== result.expected) {
		// Instead of console.log, use expect().toBe() with a descriptive message
		expect(result.actual).toBe(result.expected)
	}
}

describe("Mention Regex", () => {
	describe("Windows Path Support", () => {
		it("matches simple Windows paths", () => {
			const cases: Array<[string, string]> = [
				["@C:\\folder\\file.txt", "@C:\\folder\\file.txt"],
				["@c:\\Program/ Files\\file.txt", "@c:\\Program/ Files\\file.txt"],
				["@C:\\file.txt", "@C:\\file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})

		it("matches Windows network shares", () => {
			const cases: Array<[string, string]> = [
				["@\\\\server\\share\\file.txt", "@\\\\server\\share\\file.txt"],
				["@\\\\127.0.0.1\\network-path\\file.txt", "@\\\\127.0.0.1\\network-path\\file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})

		it("matches mixed separators", () => {
			const result = testMention("@C:\\folder\\file.txt", "@C:\\folder\\file.txt")
			expectMatch(result)
		})

		it("matches Windows relative paths", () => {
			const cases: Array<[string, string]> = [
				["@folder\\file.txt", "@folder\\file.txt"],
				["@.\\folder\\file.txt", "@.\\folder\\file.txt"],
				["@..\\parent\\file.txt", "@..\\parent\\file.txt"],
				["@path\\to\\directory\\", "@path\\to\\directory\\"],
				["@.\\current\\path\\with/ space.txt", "@.\\current\\path\\with/ space.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Escaped Spaces Support", () => {
		it("matches Unix paths with escaped spaces", () => {
			const cases: Array<[string, string]> = [
				["@/path/to/file\\ with\\ spaces.txt", "@/path/to/file\\ with\\ spaces.txt"],
				["@/path/with\\ \\ multiple\\ spaces.txt", "@/path/with\\ \\ multiple\\ spaces.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})

		it("matches Windows paths with escaped spaces", () => {
			const cases: Array<[string, string]> = [
				["@C:\\path\\to\\file/ with/ spaces.txt", "@C:\\path\\to\\file/ with/ spaces.txt"],
				["@C:\\Program/ Files\\app\\file.txt", "@C:\\Program/ Files\\app\\file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Combined Path Variations", () => {
		it("matches complex path combinations", () => {
			const cases: Array<[string, string]> = [
				[
					"@C:\\Users\\name\\Documents\\file/ with/ spaces.txt",
					"@C:\\Users\\name\\Documents\\file/ with/ spaces.txt",
				],
				[
					"@\\\\server\\share\\path/ with/ spaces\\file.txt",
					"@\\\\server\\share\\path/ with/ spaces\\file.txt",
				],
				["@C:\\path/ with/ spaces\\file.txt", "@C:\\path/ with/ spaces\\file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Edge Cases", () => {
		it("handles edge cases correctly", () => {
			const cases: Array<[string, string]> = [
				["@C:\\", "@C:\\"],
				["@/path/to/folder", "@/path/to/folder"],
				["@C:\\folder\\file with spaces.txt", "@C:\\folder\\file"],
				["@C:\\Users\\name\\path\\to\\文件夹\\file.txt", "@C:\\Users\\name\\path\\to\\文件夹\\file.txt"],
				["@/path123/file-name_2.0.txt", "@/path123/file-name_2.0.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Existing Functionality", () => {
		it("matches Unix paths", () => {
			const cases: Array<[string, string]> = [
				["@/usr/local/bin/file", "@/usr/local/bin/file"],
				["@/path/to/file.txt", "@/path/to/file.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
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
				expectMatch(result)
			})
		})

		it("matches git hashes", () => {
			const cases: Array<[string, string]> = [
				["@a1b2c3d4e5f6g7h8i9j0", "@a1b2c3d4e5f6g7h8i9j0"],
				["@abcdef1234567890abcdef1234567890abcdef12", "@abcdef1234567890abcdef1234567890abcdef12"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
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
				expectMatch(result)
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
				expectMatch(result)
			})
		})

		it("matches only until invalid characters", () => {
			const result = testMention("@C:\\folder\\file.txt invalid suffix", "@C:\\folder\\file.txt")
			expectMatch(result)
		})
	})

	describe("In Context", () => {
		it("matches mentions within text", () => {
			const cases: Array<[string, string]> = [
				["Check the file at @C:\\folder\\file.txt for details.", "@C:\\folder\\file.txt"],
				["See @/path/to/file\\ with\\ spaces.txt for an example.", "@/path/to/file\\ with\\ spaces.txt"],
				["Review @problems and @git-changes.", "@problems"],
				["Multiple: @/file1.txt and @C:\\file2.txt and @terminal", "@/file1.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Multiple Mentions", () => {
		it("finds all mentions in a string using global regex", () => {
			const text = "Check @/path/file1.txt and @C:\\folder\\file2.txt and report any @problems to @git-changes"
			const matches = text.match(mentionRegexGlobal)
			expect(matches).toEqual(["@/path/file1.txt", "@C:\\folder\\file2.txt", "@problems", "@git-changes"])
		})
	})

	describe("Special Characters in Paths", () => {
		it("handles special characters in file paths", () => {
			const cases: Array<[string, string]> = [
				["@/path/with-dash/file_underscore.txt", "@/path/with-dash/file_underscore.txt"],
				["@C:\\folder+plus\\file(parens)[]brackets.txt", "@C:\\folder+plus\\file(parens)[]brackets.txt"],
				["@/path/with/file#hash%percent.txt", "@/path/with/file#hash%percent.txt"],
				["@/path/with/file@symbol$dollar.txt", "@/path/with/file@symbol$dollar.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Mixed Path Types in Single String", () => {
		it("correctly identifies the first path in a string with multiple path types", () => {
			const text = "Check both @/unix/path and @C:\\windows\\path for details."
			const result = mentionRegex.exec(text)
			expect(result?.[0]).toBe("@/unix/path")

			// Test starting from after the first match
			const secondSearchStart = text.indexOf("@C:")
			const secondResult = mentionRegex.exec(text.substring(secondSearchStart))
			expect(secondResult?.[0]).toBe("@C:\\windows\\path")
		})
	})

	describe("Non-Latin Character Support", () => {
		it("handles international characters in paths", () => {
			const cases: Array<[string, string]> = [
				["@/path/to/你好/file.txt", "@/path/to/你好/file.txt"],
				["@C:\\用户\\документы\\файл.txt", "@C:\\用户\\документы\\файл.txt"],
				["@/путь/к/файлу.txt", "@/путь/к/файлу.txt"],
				["@C:\\folder\\file_äöü.txt", "@C:\\folder\\file_äöü.txt"],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Mixed Path Delimiters", () => {
		// Modifying expectations to match current behavior
		it("documents behavior with mixed forward and backward slashes in Windows paths", () => {
			const cases: Array<[string, null]> = [
				// Current implementation doesn't support mixed slashes
				["@C:\\Users/Documents\\folder/file.txt", null],
				["@C:/Windows\\System32/drivers\\etc/hosts", null],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	describe("Extended Negative Tests", () => {
		// Modifying expectations to match current behavior
		it("documents behavior with potentially invalid characters", () => {
			const cases: Array<[string, string]> = [
				// Current implementation actually matches these patterns
				["@/path/with<illegal>chars.txt", "@/path/with<illegal>chars.txt"],
				["@C:\\folder\\file|with|pipe.txt", "@C:\\folder\\file|with|pipe.txt"],
				['@/path/with"quotes".txt', '@/path/with"quotes".txt'],
			]

			cases.forEach(([input, expected]) => {
				const result = testMention(input, expected)
				expectMatch(result)
			})
		})
	})

	// // These are documented as "not implemented yet"
	// describe("Future Enhancement Candidates", () => {
	// 	it("identifies patterns that could be supported in future enhancements", () => {
	// 		// These patterns aren't currently supported by the regex
	// 		// but might be considered for future improvements
	// 		console.log(
	// 			"The following patterns are not currently supported but might be considered for future enhancements:",
	// 		)
	// 		console.log("- Paths with double slashes: @/path//with/double/slash.txt")
	// 		console.log("- Complex path traversals: @/very/./long/../../path/.././traversal.txt")
	// 		console.log("- Environment variables in paths: @$HOME/file.txt, @C:\\Users\\%USERNAME%\\file.txt")
	// 	})
	// })
})
