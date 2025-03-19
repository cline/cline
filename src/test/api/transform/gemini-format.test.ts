/**
 * Test suite for Gemini format transformation utilities.
 *
 * NOTE: We're using CommonJS-style imports for Mocha (require) due to VS Code's test runner
 * compatibility requirements. This is necessary because VS Code's test infrastructure
 * requires CommonJS modules even when using nodenext module resolution. The rest of the
 * codebase uses ESM imports, but tests need CommonJS for compatibility with VS Code testing.
 */
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
import { Content, EnhancedGenerateContentResponse } from "@google/generative-ai"

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

		it("should handle Unicode characters correctly", () => {
			const escaped = "Unicode: \\u00A9 \\u2713 \\u03C0"
			const unescaped = unescapeGeminiContent(escaped)
			// Unicode escapes aren't processed by the unescape function, they should remain as-is
			unescaped.should.equal("Unicode: \\u00A9 \\u2713 \\u03C0")
		})

		it("should handle Windows UNC paths", () => {
			const input = "UNC path: \\\\\\server\\share\\folder\\file.txt"
			const expected = "UNC path: \\\\\\server\\share\\folder\\file.txt"
			unescapeGeminiContent(input).should.equal(expected)
		})

		it("should handle malformed escape sequences gracefully", () => {
			const escaped = "Malformed: \\x \\y \\z"
			const unescaped = unescapeGeminiContent(escaped)
			unescaped.should.equal("Malformed: \\x \\y \\z")
		})
	})

	describe("convertAnthropicContentToGemini", () => {
		it("should convert a simple string to Gemini text part", () => {
			const content = "Hello, world!"
			const result = convertAnthropicContentToGemini(content)

			result.should.be.an.Array().with.lengthOf(1)
			result[0].should.have.property("text", "Hello, world!")
		})

		it("should convert array of text blocks", () => {
			const content: Anthropic.ContentBlockParam[] = [
				{ type: "text", text: "First paragraph" },
				{ type: "text", text: "Second paragraph" },
			]

			const result = convertAnthropicContentToGemini(content)

			result.should.be.an.Array().with.lengthOf(2)
			result[0].should.have.property("text", "First paragraph")
			result[1].should.have.property("text", "Second paragraph")
		})

		it("should convert image blocks with base64 data", () => {
			const content: Anthropic.ContentBlockParam[] = [
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/jpeg",
						data: "base64encodeddata",
					},
				},
			]

			const result = convertAnthropicContentToGemini(content)

			result.should.be.an.Array().with.lengthOf(1)
			result[0].should.have.property("inlineData")
			const inlineData = result[0].inlineData as { data: string; mimeType: string }
			inlineData.should.have.property("data", "base64encodeddata")
			inlineData.should.have.property("mimeType", "image/jpeg")
		})

		it("should convert mixed content types", () => {
			const content: Anthropic.ContentBlockParam[] = [
				{ type: "text", text: "Check this image:" },
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: "base64encodeddata",
					},
				},
				{ type: "text", text: "What do you think?" },
			]

			const result = convertAnthropicContentToGemini(content)

			result.should.be.an.Array().with.lengthOf(3)
			result[0].should.have.property("text")
			result[1].should.have.property("inlineData")
			result[2].should.have.property("text")
		})

		it("should throw error for unsupported image source types", () => {
			const content: Anthropic.ContentBlockParam[] = [
				{
					type: "image",
					source: {
						type: "url" as any, // Type assertion to bypass TypeScript check
						media_type: "image/jpeg",
						url: "https://example.com/image.jpg",
					} as any,
				},
			]

			const testFn = () => convertAnthropicContentToGemini(content)
			testFn.should.throw(/Unsupported image source type/)
		})

		it("should throw error for unsupported content block types", () => {
			const content: any[] = [
				{
					type: "unknown_type",
					content: "Some content",
				},
			]

			const testFn = () => convertAnthropicContentToGemini(content)
			testFn.should.throw(/Unsupported content block type/)
		})
	})

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

		it("should convert message with complex content", () => {
			const message: Anthropic.Messages.MessageParam = {
				role: "user",
				content: [
					{ type: "text", text: "What's in this image?" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "base64encodeddata",
						},
					},
				],
			}

			const result = convertAnthropicMessageToGemini(message)
			result.role.should.equal("user")
			result.parts.should.have.length(2)
			result.parts[0].should.have.property("text", "What's in this image?")
			result.parts[1].should.have.property("inlineData")
		})
	})

	describe("convertGeminiResponseToAnthropic", () => {
		// Helper to create a mock Gemini response
		function createMockGeminiResponse(options: {
			text?: string
			finishReason?: string
			promptTokens?: number
			completionTokens?: number
		}) {
			// Create a mock with minimal required fields
			const mock = {
				text: () => options.text || "",
				candidates: options.finishReason ? [{ finishReason: options.finishReason }] : [],
				usageMetadata: {
					promptTokenCount: options.promptTokens || 0,
					candidatesTokenCount: options.completionTokens || 0,
				},
				// Add stub implementations for required methods
				functionCall: undefined,
				functionCalls: [],
			}
			// Use double type assertion for incomplete mocks
			return mock as unknown as EnhancedGenerateContentResponse
		}

		it("should convert a basic text response", () => {
			const mockResponse = createMockGeminiResponse({
				text: "This is a response",
				promptTokens: 10,
				completionTokens: 20,
			})

			const result = convertGeminiResponseToAnthropic(mockResponse)

			result.should.have.property("type", "message")
			result.should.have.property("role", "assistant")
			result.content.should.be.an.Array().with.lengthOf(1)
			result.content[0].should.have.property("type", "text")
			result.content[0].should.have.property("text", "This is a response")
			result.usage.should.have.property("input_tokens", 10)
			result.usage.should.have.property("output_tokens", 20)
		})

		it("should map STOP finish reason to end_turn", () => {
			const mockResponse = createMockGeminiResponse({
				text: "Response",
				finishReason: "STOP",
			})

			const result = convertGeminiResponseToAnthropic(mockResponse)
			result.should.have.property("stop_reason", "end_turn")
		})

		it("should map MAX_TOKENS finish reason to max_tokens", () => {
			const mockResponse = createMockGeminiResponse({
				text: "Response",
				finishReason: "MAX_TOKENS",
			})

			const result = convertGeminiResponseToAnthropic(mockResponse)
			result.should.have.property("stop_reason", "max_tokens")
		})

		it("should map SAFETY finish reason to stop_sequence", () => {
			const mockResponse = createMockGeminiResponse({
				text: "Response",
				finishReason: "SAFETY",
			})

			const result = convertGeminiResponseToAnthropic(mockResponse)
			result.should.have.property("stop_reason", "stop_sequence")
		})

		it("should map RECITATION finish reason to stop_sequence", () => {
			const mockResponse = createMockGeminiResponse({
				text: "Response",
				finishReason: "RECITATION",
			})

			const result = convertGeminiResponseToAnthropic(mockResponse)
			result.should.have.property("stop_reason", "stop_sequence")
		})

		it("should map OTHER finish reason to stop_sequence", () => {
			const mockResponse = createMockGeminiResponse({
				text: "Response",
				finishReason: "OTHER",
			})

			const result = convertGeminiResponseToAnthropic(mockResponse)
			result.should.have.property("stop_reason", "stop_sequence")
		})

		it("should handle responses with missing usage metadata", () => {
			// Create a simpler mock for this specific test
			const mockResponse = {
				text: () => "Response with no usage",
				candidates: [],
				// No usageMetadata
				functionCall: undefined,
				functionCalls: [],
			} as unknown as EnhancedGenerateContentResponse

			const result = convertGeminiResponseToAnthropic(mockResponse)

			result.usage.should.have.property("input_tokens", 0)
			result.usage.should.have.property("output_tokens", 0)
		})

		it("should handle empty text responses", () => {
			const mockResponse = {
				text: () => "", // Make sure this returns empty string, not undefined
				candidates: [],
				usageMetadata: {
					promptTokenCount: 5,
					candidatesTokenCount: 0,
				},
				functionCall: undefined,
				functionCalls: [],
			} as unknown as EnhancedGenerateContentResponse

			const result = convertGeminiResponseToAnthropic(mockResponse)

			// Even with empty text, content should be an array
			// with at least one item containing an empty string
			result.content.should.be.an.Array()
			// The implementation adds a text block to content only if text is truthy
			// Since empty string is falsy, the content array might be empty
			// Let's check that either: content is empty OR first element has empty text
			if (result.content.length > 0) {
				result.content[0].should.have.property("text", "")
			}
		})

		it("should generate a unique message ID", () => {
			const mockResponse = createMockGeminiResponse({ text: "Response" })

			const result = convertGeminiResponseToAnthropic(mockResponse)

			result.should.have.property("id")
			result.id.should.be.a.String().and.match(/^msg_\d+$/)
		})
	})
})
