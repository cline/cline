// npx vitest services/code-index/processors/__tests__/parser.spec.ts

import { CodeParser, codeParser } from "../parser"
import { loadRequiredLanguageParsers } from "../../../tree-sitter/languageParser"
import { parseMarkdown } from "../../../tree-sitter/markdownParser"
import { readFile } from "fs/promises"
import { Node } from "web-tree-sitter"

// Mock TelemetryService
vi.mock("../../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Override Jest-based fs/promises mock with vitest-compatible version
vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdir: vi.fn(),
		access: vi.fn(),
		rename: vi.fn(),
		constants: {},
	},
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	access: vi.fn(),
	rename: vi.fn(),
}))

vi.mock("../../../tree-sitter/languageParser")
vi.mock("../../../tree-sitter/markdownParser")

const mockLanguageParser = {
	js: {
		parser: {
			parse: vi.fn((content: string) => ({
				rootNode: {
					text: content,
					startPosition: { row: 0 },
					endPosition: { row: content.split("\n").length - 1 },
					children: [],
					type: "program",
				},
			})),
		},
		query: {
			captures: vi.fn().mockReturnValue([]),
		},
	},
}

describe("CodeParser", () => {
	let parser: CodeParser

	beforeEach(() => {
		vi.clearAllMocks()
		parser = new CodeParser()
		;(loadRequiredLanguageParsers as any).mockResolvedValue(mockLanguageParser as any)
		// Set up default fs.readFile mock return value
		vi.mocked(readFile).mockResolvedValue("// default test content")
	})

	describe("parseFile", () => {
		it("should return empty array for unsupported extensions", async () => {
			const result = await parser.parseFile("test.unsupported")
			expect(result).toEqual([])
		})

		it("should use provided content instead of reading file when options.content is provided", async () => {
			const content = `/* This is a long test content string that exceeds 100 characters to properly test the parser's behavior with large inputs.
			It includes multiple lines and various JavaScript constructs to simulate real-world code.
			const a = 1;
			const b = 2;
			function test() { return a + b; }
			class Example { constructor() { this.value = 42; } }
			// More comments to pad the length to ensure we hit the minimum character requirement */`
			const result = await parser.parseFile("test.js", { content })
			expect(vi.mocked(readFile)).not.toHaveBeenCalled()
			expect(result.length).toBeGreaterThan(0)
		})

		it("should read file when no content is provided", async () => {
			const testContent = `/* This is a long test content string that exceeds 100 characters to properly test file reading behavior.
			It includes multiple lines and various JavaScript constructs to simulate real-world code.
			const x = 10;
			const y = 20;
			function calculate() { return x * y; }
			class Calculator {
				constructor() { this.history = []; }
				add(a, b) { return a + b; }
			}
			// More comments to pad the length to ensure we hit the minimum character requirement */`

			// Reset the mock and set new return value
			vi.mocked(readFile).mockReset()
			vi.mocked(readFile).mockResolvedValue(testContent)

			const result = await parser.parseFile("test.js")
			expect(vi.mocked(readFile)).toHaveBeenCalledWith("test.js", "utf8")
			expect(result.length).toBeGreaterThan(0)
		})

		it("should handle file read errors gracefully", async () => {
			// Reset the mock and set it to reject
			vi.mocked(readFile).mockReset()
			vi.mocked(readFile).mockRejectedValue(new Error("File not found"))
			const result = await parser.parseFile("test.js")
			expect(result).toEqual([])
		})

		it("should use provided fileHash when available", async () => {
			const content = `/* This is a long test content string that exceeds 100 characters to test fileHash behavior.
			It includes multiple lines and various JavaScript constructs to simulate real-world code.
			const items = [1, 2, 3];
			const sum = items.reduce((a, b) => a + b, 0);
			function processItems(items) {
				return items.map(item => item * 2);
			}
			// More comments to pad the length to ensure we hit the minimum character requirement */`
			const fileHash = "test-hash"
			const result = await parser.parseFile("test.js", { content, fileHash })
			expect(result[0].fileHash).toBe(fileHash)
		})
	})

	describe("isSupportedLanguage", () => {
		it("should return true for supported extensions", () => {
			expect(parser["isSupportedLanguage"](".js")).toBe(true)
		})

		it("should return false for unsupported extensions", () => {
			expect(parser["isSupportedLanguage"](".unsupported")).toBe(false)
		})
	})

	describe("createFileHash", () => {
		it("should generate consistent hashes for same content", () => {
			const content = "test content"
			const hash1 = parser["createFileHash"](content)
			const hash2 = parser["createFileHash"](content)
			expect(hash1).toBe(hash2)
			expect(hash1).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex format
		})

		it("should generate different hashes for different content", () => {
			const hash1 = parser["createFileHash"]("content1")
			const hash2 = parser["createFileHash"]("content2")
			expect(hash1).not.toBe(hash2)
		})
	})

	describe("parseContent", () => {
		it("should wait for pending parser loads", async () => {
			const pendingLoad = new Promise((resolve) => setTimeout(() => resolve(mockLanguageParser), 100))
			parser["pendingLoads"].set(".js", pendingLoad as Promise<any>)

			const result = await parser["parseContent"]("test.js", "const test = 123", "hash")
			expect(result).toBeDefined()
		})

		it("should handle parser load errors", async () => {
			;(loadRequiredLanguageParsers as any).mockRejectedValue(new Error("Load failed"))
			const result = await parser["parseContent"]("test.js", "const test = 123", "hash")
			expect(result).toEqual([])
		})

		it("should return empty array when no parser is available", async () => {
			;(loadRequiredLanguageParsers as any).mockResolvedValue({} as any)
			const result = await parser["parseContent"]("test.js", "const test = 123", "hash")
			expect(result).toEqual([])
		})
	})

	describe("_performFallbackChunking", () => {
		it("should chunk content when no captures are found", async () => {
			const content = `/* This is a long test content string that exceeds 100 characters to test fallback chunking behavior.
			It includes multiple lines and various JavaScript constructs to simulate real-world code.
			line1: const a = 1;
			line2: const b = 2;
			line3: function sum() { return a + b; }
			line4: class Adder { constructor(x, y) { this.x = x; this.y = y; } }
			line5: const instance = new Adder(1, 2);
			line6: console.log(instance.x + instance.y);
			line7: // More comments to pad the length to ensure we hit the minimum character requirement */`
			const result = await parser["_performFallbackChunking"]("test.js", content, "hash", new Set())
			expect(result.length).toBeGreaterThan(0)
			expect(result[0].type).toBe("fallback_chunk")
		})

		it("should respect MIN_BLOCK_CHARS for fallback chunks", async () => {
			const shortContent = "short"
			const result = await parser["_performFallbackChunking"]("test.js", shortContent, "hash", new Set())
			expect(result).toEqual([])
		})

		it("should respect 50-character minimum threshold for all languages", async () => {
			// Test content that is exactly 49 characters (should be filtered)
			const shortContent = "function f() { return 1; } // Exactly 49 chars!!!"
			expect(shortContent.length).toBe(49)

			// Test content that is exactly 50 characters (should be included)
			const minContent = "function g() { return 42; } // Exactly 50 chars!!!"
			expect(minContent.length).toBe(50)

			// Test content that is longer than 50 characters (should be included)
			const longContent = "function calculate() { return 1 + 2 + 3; } // This is longer than 50 characters"
			expect(longContent.length).toBeGreaterThan(50)

			// Mock the language parser to return captures for our test content
			const mockCapture = (content: string, startLine: number = 0) => ({
				node: {
					text: content,
					startPosition: { row: startLine },
					endPosition: { row: startLine },
					type: "function_declaration",
					childForFieldName: vi.fn().mockReturnValue(null),
					children: [],
				},
				name: "definition.function",
			})

			// Test short content (49 chars) - should be filtered out
			mockLanguageParser.js.query.captures.mockReturnValue([mockCapture(shortContent)])
			const shortResult = await parser["parseContent"]("test.js", shortContent, "hash1")
			expect(shortResult).toEqual([])

			// Test minimum content (50 chars) - should be included
			mockLanguageParser.js.query.captures.mockReturnValue([mockCapture(minContent)])
			const minResult = await parser["parseContent"]("test.js", minContent, "hash2")
			expect(minResult.length).toBe(1)
			expect(minResult[0].content).toBe(minContent)

			// Test longer content - should be included
			mockLanguageParser.js.query.captures.mockReturnValue([mockCapture(longContent)])
			const longResult = await parser["parseContent"]("test.js", longContent, "hash3")
			expect(longResult.length).toBe(1)
			expect(longResult[0].content).toBe(longContent)
		})
	})

	describe("_chunkLeafNodeByLines", () => {
		it("should chunk leaf nodes by lines", async () => {
			const mockNode = {
				text: `/* This is a long test content string that exceeds 100 characters to test line chunking behavior.
				line1: const a = 1;
				line2: const b = 2;
				line3: function sum() { return a + b; }
				line4: class Multiplier { constructor(x, y) { this.x = x; this.y = y; } }
				line5: const instance = new Multiplier(3, 4);
				line6: console.log(instance.x * instance.y);
				line7: // More comments to pad the length to ensure we hit the minimum character requirement */`,
				startPosition: { row: 10 },
				endPosition: { row: 12 },
				type: "function",
			} as unknown as Node

			const result = await parser["_chunkLeafNodeByLines"](mockNode, "test.js", "hash", new Set())
			expect(result.length).toBeGreaterThan(0)
			expect(result[0].type).toBe("function")
			expect(result[0].start_line).toBe(11) // 1-based
		})
	})

	describe("_chunkTextByLines", () => {
		it("should handle oversized lines by splitting them", async () => {
			const longLine = "a".repeat(2000)
			const lines = ["normal", longLine, "normal"]
			const result = await parser["_chunkTextByLines"](lines, "test.js", "hash", "test_type", new Set(), 100)

			const segments = result.filter((r) => r.type === "test_type_segment")
			expect(segments.length).toBeGreaterThan(1)
		})

		it("should re-balance chunks when remainder is too small", async () => {
			const lines = Array(100)
				.fill("line with 10 chars")
				.map((_, i) => `${i}: line`)
			const result = await parser["_chunkTextByLines"](lines, "test.js", "hash", "test_type", new Set(), 100)

			result.forEach((chunk) => {
				expect(chunk.content.length).toBeGreaterThanOrEqual(100)
				expect(chunk.content.length).toBeLessThanOrEqual(1150)
			})
		})
	})

	describe("singleton instance", () => {
		it("should maintain parser state across calls", async () => {
			const result1 = await codeParser.parseFile("test.js", { content: "const a = 1" })
			const result2 = await codeParser.parseFile("test.js", { content: "const b = 2" })
			expect(result1).toBeDefined()
			expect(result2).toBeDefined()
		})
	})

	describe("Markdown Support", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should generate unique segment hashes for each markdown block", async () => {
			const markdownContent = `# Section One
This is a section with substantial content that meets the minimum character requirements.
It contains detailed information and multiple paragraphs to ensure proper indexing.
The content is comprehensive and provides valuable information for search functionality.

## Section Two
Another section with different content but also meeting the minimum requirements.
This ensures we can test that different sections get different segment hashes.
Each section should have its own unique hash based on its content.`

			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 4 }, text: "Section One" },
					name: "name.definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 4 }, text: "Section One" },
					name: "definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 5 }, endPosition: { row: 8 }, text: "Section Two" },
					name: "name.definition.header.h2",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 5 }, endPosition: { row: 8 }, text: "Section Two" },
					name: "definition.header.h2",
					patternIndex: 0,
				},
			] as any)

			const result = await parser.parseFile("test.md", { content: markdownContent })

			expect(result).toHaveLength(2)

			// Verify each block has unique segment hash
			expect(result[0].segmentHash).toMatch(/^[a-f0-9]{64}$/)
			expect(result[1].segmentHash).toMatch(/^[a-f0-9]{64}$/)
			expect(result[0].segmentHash).not.toBe(result[1].segmentHash)

			// Verify file hash is consistent
			expect(result[0].fileHash).toBe(result[1].fileHash)
			expect(result[0].fileHash).toMatch(/^[a-f0-9]{64}$/)
		})

		it("should use fallback chunking for markdown files without headers", async () => {
			const markdownContent = `This is a markdown file without any headers but with substantial content.
It contains multiple paragraphs and detailed information that should be indexed.
The content is long enough to meet the minimum character requirements for fallback chunking.
This ensures that even headerless markdown files can be properly indexed and searched.
Additional content to ensure we exceed the minimum block size requirements for proper indexing.`

			vi.mocked(parseMarkdown).mockReturnValue([])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			expect(parseMarkdown).toHaveBeenCalledWith(markdownContent)
			expect(result).toHaveLength(1)
			expect(result[0].type).toBe("markdown_content")
			expect(result[0].content).toBe(markdownContent)
			expect(result[0].start_line).toBe(1)

			// Verify hash generation for fallback chunks
			expect(result[0].segmentHash).toMatch(/^[a-f0-9]{64}$/)
			expect(result[0].fileHash).toMatch(/^[a-f0-9]{64}$/)
		})

		it("should chunk large markdown files with no headers", async () => {
			// Create a large markdown file without headers (2000+ chars)
			const lines = []
			for (let i = 0; i < 80; i++) {
				lines.push(`This is line ${i} with substantial content to ensure proper chunking behavior.`)
			}
			const largeMarkdownContent = lines.join("\n") // ~80 lines * ~78 chars = ~6240 chars

			vi.mocked(parseMarkdown).mockReturnValue([])

			const result = await parser.parseFile("test.md", { content: largeMarkdownContent })

			expect(parseMarkdown).toHaveBeenCalledWith(largeMarkdownContent)
			// Should have multiple chunks due to size
			expect(result.length).toBeGreaterThan(1)
			// All chunks should be of type markdown_content
			result.forEach((block) => {
				expect(block.type).toBe("markdown_content")
				expect(block.identifier).toBeNull()
				// Each chunk should respect MAX_BLOCK_CHARS * MAX_CHARS_TOLERANCE_FACTOR
				expect(block.content.length).toBeLessThanOrEqual(1150)
			})
			// Verify chunks cover the entire content
			const totalLines = result.reduce((acc, block) => {
				return acc + (block.end_line - block.start_line + 1)
			}, 0)
			expect(totalLines).toBe(80)
		})

		it("should enforce MIN_BLOCK_CHARS for all markdown sections", async () => {
			const markdownContent = `# Short
Small content.

## Another Short
Also small.

### Long Section
This section has substantial content that exceeds the minimum character requirements.
It includes multiple lines with detailed information to ensure proper indexing.
The content is comprehensive enough to be included in the search results.`

			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 1 }, text: "Short" },
					name: "name.definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 1 }, text: "Short" },
					name: "definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 3 }, endPosition: { row: 4 }, text: "Another Short" },
					name: "name.definition.header.h2",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 3 }, endPosition: { row: 4 }, text: "Another Short" },
					name: "definition.header.h2",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 6 }, endPosition: { row: 9 }, text: "Long Section" },
					name: "name.definition.header.h3",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 6 }, endPosition: { row: 9 }, text: "Long Section" },
					name: "definition.header.h3",
					patternIndex: 0,
				},
			] as any)

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Only the long section should be included
			expect(result).toHaveLength(1)
			expect(result[0].identifier).toBe("Long Section")
			expect(result[0].content.length).toBeGreaterThanOrEqual(100) // MIN_BLOCK_CHARS
		})

		it("should chunk large markdown sections and generate unique hashes for each chunk", async () => {
			// Create content with multiple lines
			const lines = []
			// Add header
			lines.push("# Large Section Header")
			// Add 50 lines of content, each ~30 chars = ~1500 chars total
			for (let i = 0; i < 50; i++) {
				lines.push(`This is line ${i} with some content.`)
			}

			const markdownContent = lines.join("\n")

			// The mock should return sections that span the actual content
			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 50 }, // Header + 50 lines of content
						text: "Large Section Header",
					},
					name: "name.definition.header.h1",
					patternIndex: 0,
				},
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 50 }, // Header + 50 lines of content
						text: markdownContent, // Full section content
					},
					name: "definition.header.h1",
					patternIndex: 0,
				},
			] as any)

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Large section should be chunked into multiple blocks
			const h1Blocks = result.filter((r) => r.type === "markdown_header_h1")
			expect(h1Blocks.length).toBeGreaterThan(1)

			// Each chunk should have a unique segment hash
			const segmentHashes = h1Blocks.map((block) => block.segmentHash)
			const uniqueHashes = new Set(segmentHashes)
			expect(uniqueHashes.size).toBe(h1Blocks.length)

			// All chunks should preserve the header identifier
			h1Blocks.forEach((block) => {
				expect(block.identifier).toBe("Large Section Header")
				// Each chunk should respect MAX_BLOCK_CHARS * MAX_CHARS_TOLERANCE_FACTOR
				expect(block.content.length).toBeLessThanOrEqual(1150)
				// Each chunk should have valid hashes
				expect(block.segmentHash).toMatch(/^[a-f0-9]{64}$/)
				expect(block.fileHash).toMatch(/^[a-f0-9]{64}$/)
			})
		})

		it("should handle markdown with very long single lines with chunking", async () => {
			const veryLongLine = "a".repeat(2000) // Single line exceeding max chars
			const markdownContent = `# Section with Long Line
Normal content here.
${veryLongLine}
More normal content.`

			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 3 }, text: "Section with Long Line" },
					name: "name.definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 3 }, text: markdownContent },
					name: "definition.header.h1",
					patternIndex: 0,
				},
			] as any)

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Should create multiple blocks due to chunking
			expect(result.length).toBeGreaterThan(1)
			// Should have segment blocks for the oversized line
			const segmentBlocks = result.filter((r) => r.type === "markdown_header_h1_segment")
			expect(segmentBlocks.length).toBeGreaterThan(0)
			// All blocks should preserve the header identifier
			result.forEach((block) => {
				expect(block.identifier).toBe("Section with Long Line")
			})
		})

		it("should preserve header information when chunking large sections", async () => {
			const largeContent = Array(100).fill("Line with substantial content to ensure proper handling.").join("\n")
			const markdownContent = `### Deep Header Level 3
${largeContent}`

			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 100 }, text: "Deep Header Level 3" },
					name: "name.definition.header.h3",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 100 }, text: markdownContent },
					name: "definition.header.h3",
					patternIndex: 0,
				},
			] as any)

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Should have multiple blocks due to chunking
			expect(result.length).toBeGreaterThan(1)
			// All blocks should have the same type and identifier
			result.forEach((block) => {
				expect(block.type).toBe("markdown_header_h3")
				expect(block.identifier).toBe("Deep Header Level 3")
			})
		})

		it("should apply chunking logic based on MAX_BLOCK_CHARS and re-balancing", async () => {
			// Create content that will trigger re-balancing logic
			// 60 lines * 30 chars = 1800 chars, which should trigger chunking
			const lines = []
			for (let i = 0; i < 60; i++) {
				lines.push(`Line ${i}: Some content here to test.`) // ~30 chars per line
			}
			const markdownContent = lines.join("\n")

			vi.mocked(parseMarkdown).mockReturnValue([])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Should have multiple chunks due to size
			expect(result.length).toBeGreaterThan(1)

			// Verify re-balancing: chunks should be roughly equal in size
			const chunkSizes = result.map((block) => block.content.length)
			const avgSize = chunkSizes.reduce((a, b) => a + b, 0) / chunkSizes.length

			chunkSizes.forEach((size) => {
				// Each chunk should be within 30% of average size (re-balanced)
				expect(Math.abs(size - avgSize) / avgSize).toBeLessThan(0.3)
				// Each chunk should respect MIN_BLOCK_CHARS
				expect(size).toBeGreaterThanOrEqual(50)
			})

			// Verify each chunk has unique segment hash
			const segmentHashes = result.map((block) => block.segmentHash)
			expect(new Set(segmentHashes).size).toBe(result.length)
		})

		it("should handle markdown content before the first header", async () => {
			const preHeaderContent = `This is content before any headers that contains substantial information.
It has multiple lines and should be indexed because it meets the minimum size requirements.
This content contains important documentation that would be lost without proper handling.
We need to ensure that all content is captured, not just content within header sections.
This paragraph continues with more details to ensure we exceed the minimum block size.`

			const headerContent = `# First Header

Content under the first header with enough text to be indexed properly.
This section contains multiple lines to ensure it meets the minimum character requirements.
We need at least 50 characters for a section to be included in the index.
This additional content ensures the header section will be processed correctly.`

			const markdownContent = `${preHeaderContent}

${headerContent}`

			// Mock the parseMarkdown function to return headers
			// The header section spans from line 6 to line 10 (5 lines total)
			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: {
						startPosition: { row: 6 },
						endPosition: { row: 10 },
						text: "First Header",
					},
					name: "name.definition.header.h1",
					patternIndex: 0,
				} as any,
				{
					node: {
						startPosition: { row: 6 },
						endPosition: { row: 10 },
						text: "First Header",
					},
					name: "definition.header.h1",
					patternIndex: 0,
				} as any,
			])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// With MIN_BLOCK_CHARS=50, content may be split into more blocks
			expect(result.length).toBeGreaterThanOrEqual(2)

			// First block should be the content before the header
			expect(result[0]).toMatchObject({
				file_path: "test.md",
				type: "markdown_content",
				start_line: 1,
				end_line: 6, // Up to the header line
			})
			expect(result[0].content).toContain("This is content before any headers")

			// Second block should be the header section
			expect(result[1]).toMatchObject({
				file_path: "test.md",
				identifier: "First Header",
				type: "markdown_header_h1",
				start_line: 7,
				end_line: 11,
			})
		})

		it("should handle markdown content after the last header", async () => {
			const markdownContent = `# Header

Header content with enough text to meet the minimum requirements for proper indexing.
This header section needs to have at least 100 characters to be included in the results.
We're adding this extra line to ensure the header section meets the minimum size threshold.

This is content after the last header that contains substantial documentation.
It has multiple lines and should be indexed because it's important information.
This content would be lost without proper handling of content outside header sections.
We're adding more content here to ensure we meet the minimum block size requirements.
This ensures that trailing content in markdown files is properly captured and indexed.`

			// Mock the parseMarkdown function to return headers
			// The header section spans from line 0 to line 4 (5 lines)
			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 4 },
						text: "Header",
					},
					name: "name.definition.header.h1",
					patternIndex: 0,
				} as any,
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 4 },
						text: "Header",
					},
					name: "definition.header.h1",
					patternIndex: 0,
				} as any,
			])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Should have exactly 2 blocks: header section and post-header content
			expect(result.length).toBe(2)

			// First block should be the header section
			expect(result[0]).toMatchObject({
				file_path: "test.md",
				identifier: "Header",
				type: "markdown_header_h1",
				start_line: 1,
				end_line: 5,
			})

			// Second block should be the content after the header
			expect(result[1]).toMatchObject({
				file_path: "test.md",
				type: "markdown_content",
				start_line: 6,
			})
			expect(result[1].content).toContain("This is content after the last header")
		})

		it("should handle very long paragraphs with chunking", async () => {
			// Create a very long paragraph
			const longParagraph = "This is a very long paragraph that contains substantial content. ".repeat(50)
			const markdownContent = `# Introduction

Some intro text.

${longParagraph}

## Conclusion

Final thoughts that need to be long enough to meet the minimum character requirement.
This conclusion section contains multiple lines to ensure it exceeds 100 characters.`

			const lines = markdownContent.split("\n")

			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 0 },
						text: "Introduction",
					},
					name: "name.definition.header.h1",
					patternIndex: 0,
				} as any,
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 4 },
						text: "Introduction",
					},
					name: "definition.header.h1",
					patternIndex: 0,
				} as any,
				{
					node: {
						startPosition: { row: 6 },
						endPosition: { row: 6 },
						text: "Conclusion",
					},
					name: "name.definition.header.h2",
					patternIndex: 0,
				} as any,
				{
					node: {
						startPosition: { row: 6 },
						endPosition: { row: 9 },
						text: "Conclusion",
					},
					name: "definition.header.h2",
					patternIndex: 0,
				} as any,
			])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// The introduction section should be chunked
			const h1Blocks = result.filter(
				(r) => r.type === "markdown_header_h1" || r.type === "markdown_header_h1_segment",
			)
			expect(h1Blocks.length).toBeGreaterThan(1)
			// All chunks should preserve the identifier
			h1Blocks.forEach((block) => {
				expect(block.identifier).toBe("Introduction")
			})

			// Conclusion should be a single block
			const h2Blocks = result.filter((r) => r.type === "markdown_header_h2")
			expect(h2Blocks.length).toBe(1)
		})

		it("should continue processing after encountering a very long line", async () => {
			// Create a markdown file with a very long single line followed by more content
			const veryLongLine = "a".repeat(5000) // 5000 characters - exceeds MAX_BLOCK_CHARS * MAX_CHARS_TOLERANCE_FACTOR

			// Create content that will be chunked
			const markdownContent = `This is content before the very long line that should be properly indexed.
It contains multiple lines to ensure it meets the minimum character requirements.
We need enough content here to trigger the chunking behavior.

${veryLongLine}

This is content after the very long line that must also be properly indexed.
It's critical that this content is not ignored due to the oversized line bug.
We need to ensure all content is processed, not just content before the long line.
Adding more content to ensure we meet minimum block requirements.`

			// Mock parseMarkdown to return no headers (testing fallback chunking)
			vi.mocked(parseMarkdown).mockReturnValue([])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// The content should be chunked due to the oversized line
			expect(result.length).toBeGreaterThan(1)

			// Should have segment blocks for the oversized line
			const segmentBlocks = result.filter((r) => r.type.includes("_segment"))
			expect(segmentBlocks.length).toBeGreaterThan(0)

			// Verify that content after the long line is included
			const lastBlock = result[result.length - 1]
			expect(lastBlock.content).toContain("content after the very long line")

			// Verify all segments are from the oversized line
			segmentBlocks.forEach((block) => {
				expect(block.content).toMatch(/^a+$/)
			})
		})

		it("should handle multiple oversized lines in sequence", async () => {
			// Test with multiple consecutive oversized lines
			const longLine1 = "x".repeat(3000)
			const longLine2 = "y".repeat(3000)
			const longLine3 = "z".repeat(3000)

			const markdownContent = `# Test Multiple Long Lines
Normal content before the long lines.
${longLine1}
${longLine2}
${longLine3}
Normal content after the long lines that must be indexed.
This content verifies that processing continues after multiple oversized lines.`

			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 6 },
						text: "Test Multiple Long Lines",
					},
					name: "name.definition.header.h1",
					patternIndex: 0,
				} as any,
				{
					node: {
						startPosition: { row: 0 },
						endPosition: { row: 6 },
						text: "Test Multiple Long Lines",
					},
					name: "definition.header.h1",
					patternIndex: 0,
				} as any,
			])

			const result = await parser.parseFile("test.md", { content: markdownContent })

			// Should have multiple segment blocks
			const segmentBlocks = result.filter((r) => r.type === "markdown_header_h1_segment")
			expect(segmentBlocks.length).toBeGreaterThan(6) // At least 3 segments per long line

			// Should also have regular blocks for the normal content
			const regularBlocks = result.filter((r) => r.type === "markdown_header_h1" && !r.type.includes("_segment"))
			expect(regularBlocks.length).toBeGreaterThan(0)

			// Verify the last block includes content after the long lines
			const lastRegularBlock = regularBlocks[regularBlocks.length - 1]
			expect(lastRegularBlock.content).toContain("Normal content after the long lines")
		})
	})

	describe("Edge case: Single oversized line in markdown", () => {
		beforeEach(() => {
			vi.clearAllMocks()
		})

		it("should properly chunk a markdown file with a single very long line", async () => {
			const parser = new CodeParser()
			const veryLongLine = "x".repeat(5000) // 5000 chars in a single line

			// Mock parseMarkdown to return empty array (no headers)
			vi.mocked(parseMarkdown).mockReturnValue([])

			const results = await parser["parseContent"]("test.md", veryLongLine, "test-hash")

			// Should create multiple segments
			expect(results.length).toBeGreaterThan(1)
			expect(results.length).toBe(5) // 5000 / 1000 = 5 segments

			// All chunks should be segments
			const segments = results.filter((r) => r.type === "markdown_content_segment")
			expect(segments.length).toBe(5)

			// Verify content is preserved
			const reconstructed = results.map((r) => r.content).join("")
			expect(reconstructed).toBe(veryLongLine)

			// Each segment (except possibly the last) should be MAX_BLOCK_CHARS (1000)
			for (let i = 0; i < segments.length - 1; i++) {
				expect(segments[i].content.length).toBe(1000)
			}

			// Last segment should have the remainder
			expect(segments[segments.length - 1].content.length).toBe(1000)
		})

		it("should handle markdown with headers followed by oversized lines", async () => {
			const parser = new CodeParser()
			const longLineA = "a".repeat(2000)
			const longLineB = "b".repeat(3000)
			const content = `# Header 1\n\n${longLineA}\n\n## Header 2\n\n${longLineB}`

			// Mock parseMarkdown to return headers
			vi.mocked(parseMarkdown).mockReturnValue([
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 2 }, text: "Header 1" },
					name: "name.definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 0 }, endPosition: { row: 2 }, text: "Header 1" },
					name: "definition.header.h1",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 4 }, endPosition: { row: 6 }, text: "Header 2" },
					name: "name.definition.header.h2",
					patternIndex: 0,
				},
				{
					node: { startPosition: { row: 4 }, endPosition: { row: 6 }, text: "Header 2" },
					name: "definition.header.h2",
					patternIndex: 0,
				},
			] as any)

			const results = await parser["parseContent"]("test.md", content, "test-hash")

			// Should create multiple chunks
			expect(results.length).toBeGreaterThan(2)

			// Should have both header chunks and segments
			const headers = results.filter((r) => r.type.startsWith("markdown_header"))
			const segments = results.filter((r) => r.type.includes("_segment"))

			expect(headers.length).toBeGreaterThan(0)
			expect(segments.length).toBeGreaterThan(0)

			// Verify segments were created for oversized lines
			// 2000 chars = 2 segments, 3000 chars = 3 segments
			expect(segments.length).toBeGreaterThanOrEqual(5)
		})

		it("should not chunk markdown files with lines under the threshold", async () => {
			const parser = new CodeParser()
			const normalContent = "This is a normal line.\n".repeat(50) // Multiple normal lines
			const totalLength = normalContent.length

			// Mock parseMarkdown to return empty array (no headers)
			vi.mocked(parseMarkdown).mockReturnValue([])

			const results = await parser["parseContent"]("test.md", normalContent, "test-hash")

			// Since total content is 1150 chars (23 * 50), it's just over the threshold
			// But no individual line is oversized, so it depends on total length
			if (totalLength > 1150) {
				// Content exceeds threshold, should be chunked
				expect(results.length).toBeGreaterThan(1)
			} else {
				// Content is under threshold, should be single chunk
				expect(results.length).toBe(1)
				expect(results[0].type).toBe("markdown_content")
			}
		})

		it("should return empty array for markdown content below MIN_BLOCK_CHARS threshold", async () => {
			const parser = new CodeParser()
			// Create content that is below the new MIN_BLOCK_CHARS threshold of 50
			const smallContent = "Small markdown.\nJust a bit.\nTiny."

			// Mock parseMarkdown to return empty array (no headers)
			vi.mocked(parseMarkdown).mockReturnValue([])

			const results = await parser["parseContent"]("test.md", smallContent, "test-hash")

			// Should return empty array since content is below MIN_BLOCK_CHARS (50)
			expect(results.length).toBe(0)
			expect(smallContent.length).toBeLessThan(50) // Verify our test assumption
		})
	})
})
