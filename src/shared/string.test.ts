import { describe, it } from "mocha"
import "should"
import { canonicalize, preserveEscaping } from "./string"

describe("String: canonicalize", () => {
	describe("Unicode normalization", () => {
		it("should normalize composed and decomposed unicode", () => {
			// é as single character vs e + combining acute
			const composed = "café"
			const decomposed = "cafe\u0301"
			canonicalize(composed).should.equal(canonicalize(decomposed))
		})
	})

	describe("Hyphen and dash normalization", () => {
		it("should normalize regular hyphen to ASCII hyphen", () => {
			canonicalize("hello-world").should.equal("hello-world")
		})

		it("should normalize HYPHEN (U+2010) to ASCII hyphen", () => {
			canonicalize("hello\u2010world").should.equal("hello-world")
		})

		it("should normalize NO-BREAK HYPHEN (U+2011) to ASCII hyphen", () => {
			canonicalize("hello\u2011world").should.equal("hello-world")
		})

		it("should normalize FIGURE DASH (U+2012) to ASCII hyphen", () => {
			canonicalize("hello\u2012world").should.equal("hello-world")
		})

		it("should normalize EN DASH (U+2013) to ASCII hyphen", () => {
			canonicalize("hello\u2013world").should.equal("hello-world")
		})

		it("should normalize EM DASH (U+2014) to ASCII hyphen", () => {
			canonicalize("hello\u2014world").should.equal("hello-world")
		})

		it("should normalize MINUS SIGN (U+2212) to ASCII hyphen", () => {
			canonicalize("hello\u2212world").should.equal("hello-world")
		})

		it("should normalize multiple different dashes", () => {
			canonicalize("a\u2013b\u2014c\u2212d").should.equal("a-b-c-d")
		})
	})

	describe("Double quote normalization", () => {
		it("should keep ASCII double quotes unchanged", () => {
			canonicalize('say "hello"').should.equal('say "hello"')
		})

		it("should normalize LEFT DOUBLE QUOTATION MARK (U+201C)", () => {
			canonicalize("say \u201Chello\u201D").should.equal('say "hello"')
		})

		it("should normalize RIGHT DOUBLE QUOTATION MARK (U+201D)", () => {
			canonicalize("say \u201Chello\u201D").should.equal('say "hello"')
		})

		it("should normalize DOUBLE LOW-9 QUOTATION MARK (U+201E)", () => {
			canonicalize("say \u201Ehello\u201D").should.equal('say "hello"')
		})

		it("should normalize LEFT-POINTING DOUBLE ANGLE QUOTATION MARK (U+00AB)", () => {
			canonicalize("say \u00ABhello\u00BB").should.equal('say "hello"')
		})

		it("should normalize RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK (U+00BB)", () => {
			canonicalize("say \u00ABhello\u00BB").should.equal('say "hello"')
		})
	})

	describe("Single quote normalization", () => {
		it("should keep ASCII apostrophe unchanged", () => {
			canonicalize("it's here").should.equal("it's here")
		})

		it("should normalize LEFT SINGLE QUOTATION MARK (U+2018)", () => {
			canonicalize("it\u2018s here").should.equal("it's here")
		})

		it("should normalize RIGHT SINGLE QUOTATION MARK (U+2019)", () => {
			canonicalize("it\u2019s here").should.equal("it's here")
		})

		it("should normalize SINGLE HIGH-REVERSED-9 QUOTATION MARK (U+201B)", () => {
			canonicalize("it\u201Bs here").should.equal("it's here")
		})
	})

	describe("Space normalization", () => {
		it("should keep regular spaces unchanged", () => {
			canonicalize("hello world").should.equal("hello world")
		})

		it("should normalize NO-BREAK SPACE (U+00A0) to regular space", () => {
			canonicalize("hello\u00A0world").should.equal("hello world")
		})

		it("should normalize NARROW NO-BREAK SPACE (U+202F) to regular space", () => {
			canonicalize("hello\u202Fworld").should.equal("hello world")
		})

		it("should normalize multiple non-breaking spaces", () => {
			canonicalize("a\u00A0b\u202Fc").should.equal("a b c")
		})
	})

	describe("Escaped quote normalization", () => {
		it("should normalize escaped backticks to unescaped", () => {
			canonicalize("\\`code\\`").should.equal("`code`")
		})

		it("should normalize escaped single quotes to unescaped", () => {
			canonicalize("\\'hello\\'").should.equal("'hello'")
		})

		it("should normalize escaped double quotes to unescaped", () => {
			canonicalize('\\"hello\\"').should.equal('"hello"')
		})

		it("should handle multiple escaped quotes", () => {
			canonicalize("\\`code\\` with \\'single\\' and \\\"double\\\"").should.equal("`code` with 'single' and \"double\"")
		})
	})

	describe("Combined normalization", () => {
		it("should normalize unicode punctuation and escaped quotes together", () => {
			const input = "it\u2019s a \u201Ctest\u201D with\\`backticks\\` and\u2013dashes"
			const expected = 'it\'s a "test" with`backticks` and-dashes'
			canonicalize(input).should.equal(expected)
		})

		it("should handle complex real-world code snippet", () => {
			const input = "const msg\u00A0=\u00A0\u201CHello\u2014world\u201D;"
			const expected = 'const msg = "Hello-world";'
			canonicalize(input).should.equal(expected)
		})

		it("should be idempotent", () => {
			const input = "test\u2019s \u201Cvalue\u201D\u2013here"
			const once = canonicalize(input)
			const twice = canonicalize(once)
			once.should.equal(twice)
		})
	})

	describe("Edge cases", () => {
		it("should handle empty strings", () => {
			canonicalize("").should.equal("")
		})

		it("should handle strings with no special characters", () => {
			canonicalize("hello world").should.equal("hello world")
		})

		it("should handle strings with only special characters", () => {
			canonicalize("\u2013\u201C\u00A0").should.equal('-" ')
		})

		it("should handle multiline strings", () => {
			const input = "line1\u2013test\nline2\u201Cquoted\u201D"
			const expected = 'line1-test\nline2"quoted"'
			canonicalize(input).should.equal(expected)
		})

		it("should handle strings with emoji", () => {
			const input = "hello \u{1F44B} world"
			const expected = "hello \u{1F44B} world"
			canonicalize(input).should.equal(expected)
		})
	})
})

describe("preserveEscaping", () => {
	describe("Backtick escaping", () => {
		it("should preserve escaped backticks from original text", () => {
			const original = "1. \\`file_path\\` MUST be an absolute path"
			const newText = "1. `absolute_path` MUST be an absolute path"
			const result = preserveEscaping(original, newText)
			result.should.equal("1. \\`absolute_path\\` MUST be an absolute path")
		})

		it("should not add escaping if original has no escaped backticks", () => {
			const original = "1. file_path MUST be an absolute path"
			const newText = "1. `absolute_path` MUST be an absolute path"
			const result = preserveEscaping(original, newText)
			result.should.equal("1. `absolute_path` MUST be an absolute path")
		})

		it("should not double-escape already escaped backticks", () => {
			const original = "1. \\`file_path\\` MUST be an absolute path"
			const newText = "1. \\`absolute_path\\` MUST be an absolute path"
			const result = preserveEscaping(original, newText)
			result.should.equal("1. \\`absolute_path\\` MUST be an absolute path")
		})
	})

	describe("Single quote escaping", () => {
		it("should preserve escaped single quotes from original text", () => {
			const original = "const str = \\'hello\\'"
			const newText = "const str = 'world'"
			const result = preserveEscaping(original, newText)
			result.should.equal("const str = \\'world\\'")
		})

		it("should not add escaping if original has no escaped quotes", () => {
			const original = "const str = hello"
			const newText = "const str = 'world'"
			const result = preserveEscaping(original, newText)
			result.should.equal("const str = 'world'")
		})
	})

	describe("Double quote escaping", () => {
		it("should preserve escaped double quotes from original text", () => {
			const original = 'const str = \\"hello\\"'
			const newText = 'const str = "world"'
			const result = preserveEscaping(original, newText)
			result.should.equal('const str = \\"world\\"')
		})

		it("should not add escaping if original has no escaped quotes", () => {
			const original = "const str = hello"
			const newText = 'const str = "world"'
			const result = preserveEscaping(original, newText)
			result.should.equal('const str = "world"')
		})
	})

	describe("Multiple escape types", () => {
		it("should preserve multiple escape types from original", () => {
			const original = "\`code\` with \'single\' and \"double\""
			const newText = "`test` with 'foo' and \"bar\""
			const result = preserveEscaping(original, newText)
			result.should.equal("\`test\` with \'foo\' and \"bar\"")
		})

		it("should handle text with only some escape types", () => {
			const original = "\\`code\\` with 'single'"
			const newText = "`test` with 'foo' and \"bar\""
			const result = preserveEscaping(original, newText)
			result.should.equal("\\`test\\` with 'foo' and \"bar\"")
		})
	})

	describe("Real-world patch scenario", () => {
		it("should handle the documented use case from markdown files", () => {
			const original =
				"Expectation for required parameters:\n1. \\`file_path\\` MUST be an absolute path; otherwise an error will be thrown."
			const newText =
				"Expectation for required parameters:\n1. `absolute_path` MUST be an absolute path; otherwise an error will be thrown."
			const result = preserveEscaping(original, newText)
			result.should.equal(
				"Expectation for required parameters:\n1. \\`absolute_path\\` MUST be an absolute path; otherwise an error will be thrown.",
			)
		})

		it("should work with multiline patches", () => {
			const original = "line 1 with \\`code\\`\nline 2 with \\`more\\`"
			const newText = "line 1 with `test`\nline 2 with `changed`"
			const result = preserveEscaping(original, newText)
			result.should.equal("line 1 with \\`test\\`\nline 2 with \\`changed\\`")
		})
	})

	describe("Edge cases", () => {
		it("should handle empty original text", () => {
			const original = ""
			const newText = "`code`"
			const result = preserveEscaping(original, newText)
			result.should.equal("`code`")
		})

		it("should handle empty new text", () => {
			const original = "\\`code\\`"
			const newText = ""
			const result = preserveEscaping(original, newText)
			result.should.equal("")
		})

		it("should handle text with no quotes", () => {
			const original = "hello world"
			const newText = "goodbye world"
			const result = preserveEscaping(original, newText)
			result.should.equal("goodbye world")
		})

		it("should not affect text without matching escape patterns", () => {
			const original = "\\`code\\`"
			const newText = "no quotes here"
			const result = preserveEscaping(original, newText)
			result.should.equal("no quotes here")
		})
	})
})
