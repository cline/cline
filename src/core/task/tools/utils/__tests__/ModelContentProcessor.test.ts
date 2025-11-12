import { expect } from "chai"
import { applyModelContentFixes } from "../ModelContentProcessor"

describe("ModelContentProcessor", () => {
	// Test data constants
	const MODELS = {
		CLAUDE: "claude-3-5-sonnet-20241022",
		CLAUDE_OPUS: "claude-opus",
		CLAUDE_V2: "anthropic.claude-v2",
		GEMINI: "gemini-pro",
		GEMINI_FLASH: "gemini-2.0-flash-exp",
		DEEPSEEK: "deepseek-chat",
		GPT4: "gpt-4",
	} as const

	const FILES = {
		JS: "test.js",
		PY: "test.py",
		XML: "config.xml",
		XML_DATA: "data.xml",
		XML_SETTINGS: "settings.xml",
	} as const

	const ESCAPED_CHARS = {
		LT: "&lt;",
		GT: "&gt;",
		AMP: "&amp;",
		QUOT: "&quot;",
		APOS: "&apos;",
	} as const

	describe("applyModelContentFixes", () => {
		describe("Model ID detection", () => {
			it("should skip all fixes for Claude models", () => {
				const input = "x &gt; 5\uFFFD"
				expect(applyModelContentFixes(input, MODELS.CLAUDE)).to.equal(input)
				expect(applyModelContentFixes(input, MODELS.CLAUDE_OPUS)).to.equal(input)
				expect(applyModelContentFixes(input, MODELS.CLAUDE_V2)).to.equal(input)
			})

			it("should apply fixes for non-Claude models", () => {
				const input = "x &gt; 5"
				expect(applyModelContentFixes(input, MODELS.GEMINI_FLASH)).to.equal("x > 5")
				expect(applyModelContentFixes(input, MODELS.DEEPSEEK)).to.equal("x > 5")
				expect(applyModelContentFixes(input, MODELS.GPT4)).to.equal("x > 5")
			})
		})

		describe("File type detection", () => {
			it("should detect .xml files (case-insensitive)", () => {
				const input = `${ESCAPED_CHARS.LT}test${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.XML)).to.equal(input)
				expect(applyModelContentFixes(input, MODELS.GEMINI, "file.XML")).to.equal(input)
				expect(applyModelContentFixes(input, MODELS.GEMINI, "data.Xml")).to.equal(input)
			})

			it("should not match .xml substring in middle of filename", () => {
				const input = `${ESCAPED_CHARS.LT}test${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, "myxml.txt")).to.equal("<test>")
				expect(applyModelContentFixes(input, MODELS.GEMINI, "xml_file.js")).to.equal("<test>")
			})

			it("should handle .xml file with nested paths", () => {
				const input = `${ESCAPED_CHARS.LT}config${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, "/path/to/config.xml")).to.equal(input)
				expect(applyModelContentFixes(input, MODELS.GEMINI, "../../settings.xml")).to.equal(input)
			})

			it("should handle edge case: just .xml filename", () => {
				const input = `${ESCAPED_CHARS.LT}test${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, ".xml")).to.equal(input)
			})
		})

		describe("Orchestration logic", () => {
			it("should apply escaped character fix to non-XML files", () => {
				const input = "x &gt; 5"
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.JS)).to.equal("x > 5")
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.PY)).to.equal("x > 5")
			})

			it("should skip escaped character fix for XML files", () => {
				const input = `${ESCAPED_CHARS.LT}root${ESCAPED_CHARS.GT}content${ESCAPED_CHARS.LT}/root${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.XML)).to.equal(input)
			})

			it("should always apply invalid character removal regardless of file type", () => {
				const invalidChar = "test\uFFFDdata"
				expect(applyModelContentFixes(invalidChar, MODELS.GEMINI, FILES.JS)).to.equal("testdata")
				expect(applyModelContentFixes(invalidChar, MODELS.GEMINI, FILES.XML)).to.equal("testdata")
			})

			it("should apply both fixes in correct order for non-XML files", () => {
				const input = "x &gt; 5\uFFFD"
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.JS)).to.equal("x > 5")
			})

			it("should preserve escaped chars but remove invalid chars in XML", () => {
				const input = `${ESCAPED_CHARS.LT}tag${ESCAPED_CHARS.GT}\uFFFD${ESCAPED_CHARS.LT}/tag${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.XML_DATA)).to.equal(
					`${ESCAPED_CHARS.LT}tag${ESCAPED_CHARS.GT}${ESCAPED_CHARS.LT}/tag${ESCAPED_CHARS.GT}`,
				)
			})
		})

		describe("Optional filePath parameter", () => {
			it("should apply escaped character fix when filePath not provided", () => {
				const input = "x &gt; 5"
				expect(applyModelContentFixes(input, MODELS.GEMINI)).to.equal("x > 5")
			})

			it("should apply invalid character fix when filePath not provided", () => {
				const input = "test\uFFFDdata"
				expect(applyModelContentFixes(input, MODELS.GEMINI)).to.equal("testdata")
			})

			it("should handle undefined filePath explicitly", () => {
				const input = "x &gt; 5"
				expect(applyModelContentFixes(input, MODELS.GEMINI, undefined)).to.equal("x > 5")
			})

			it("should apply fixes when modelId is not provided", () => {
				const input = "x &gt; 5"
				expect(applyModelContentFixes(input)).to.equal("x > 5")
			})
		})

		describe("Integration with real-world use cases", () => {
			it("should handle Gemini commands with shell operators", () => {
				const input = 'echo "test" &gt; file.txt'
				expect(applyModelContentFixes(input, MODELS.GEMINI_FLASH)).to.equal('echo "test" > file.txt')
			})

			it("should handle DeepSeek diffs with comparison operators", () => {
				const input = "- if (x &gt; 10)\n+ if (x &gt; 20)"
				expect(applyModelContentFixes(input, MODELS.DEEPSEEK, "app.js")).to.equal("- if (x > 10)\n+ if (x > 20)")
			})

			it("should preserve XML config files from non-Claude models", () => {
				const input = `${ESCAPED_CHARS.LT}threshold value="${ESCAPED_CHARS.GT} 100"/${ESCAPED_CHARS.GT}`
				expect(applyModelContentFixes(input, MODELS.GEMINI, FILES.XML_SETTINGS)).to.equal(input)
			})
		})
	})
})
