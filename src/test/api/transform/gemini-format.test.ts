const mocha = require("mocha")
const { describe, it } = mocha
import "should"
import {
	convertAnthropicContentToGemini,
	convertAnthropicMessageToGemini,
	unescapeGeminiContent,
	convertGeminiResponseToAnthropic,
} from "../../../api/transform/gemini-format"
import { Anthropic } from "@anthropic-ai/sdk"

describe("Gemini Format Utilities", () => {
	describe("unescapeGeminiContent", () => {
		it("should unescape newline characters", () => {
			const escaped = "line 1\\nline 2\\nline 3"
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal("line 1\nline 2\nline 3")
		})

		it("should unescape quotes", () => {
			const escaped = "He said, \\\"Hello\\\" and she said, \\'World\\'"
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal("He said, \"Hello\" and she said, 'World'")
		})

		it("should unescape tabs and carriage returns", () => {
			const escaped = "Column1\\tColumn2\\tColumn3\\r\\nRow2Col1\\tRow2Col2\\tRow2Col3"
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal("Column1\tColumn2\tColumn3\r\nRow2Col1\tRow2Col2\tRow2Col3")
		})

		it("should handle content with no escape sequences", () => {
			const content = "This is regular text with no escape sequences."
			const result = unescapeGeminiContent(content)
			result.should.equal(content)
		})

		it("should handle mixed escaped and unescaped content", () => {
			const escaped = 'Normal text\\nWith some\\nnewlines and \\"quotes\\" mixed in.'
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal('Normal text\nWith some\nnewlines and "quotes" mixed in.')
		})

		it("should handle edge cases with backslashes", () => {
			const escaped = "Windows path: C:\\\\Program Files\\\\App\\nLinux path: /usr/local/bin"
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal("Windows path: C:\\Program Files\\App\nLinux path: /usr/local/bin")
		})

		it("should handle code blocks with escaped characters", () => {
			const escaped = '```typescript\\nconst greeting = \\"Hello, world!\\"\\nconsole.log(greeting);\\n```'
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal('```typescript\nconst greeting = "Hello, world!"\nconsole.log(greeting);\n```')
		})
	})

	// Basic tests for the other functions to ensure they're working correctly
	describe("convertAnthropicMessageToGemini", () => {
		it("should convert user message correctly", () => {
			const message: Anthropic.Messages.MessageParam = {
				role: "user",
				content: "Hello, how can you help me?",
			}

			const result = convertAnthropicMessageToGemini(message)
			result.role.should.equal("user")
			result.parts.should.have.length(1)
			result.parts[0].should.have.property("text", "Hello, how can you help me?")
		})

		it("should convert assistant message to model role", () => {
			const message: Anthropic.Messages.MessageParam = {
				role: "assistant",
				content: "I'm an AI assistant. How can I help you today?",
			}

			const result = convertAnthropicMessageToGemini(message)
			result.role.should.equal("model")
			result.parts.should.have.length(1)
			result.parts[0].should.have.property("text", "I'm an AI assistant. How can I help you today?")
		})
	})
})
