// npx vitest services/code-index/processors/__tests__/parser.spec.ts

import { CodeParser, codeParser } from "../parser"
import { loadRequiredLanguageParsers } from "../../../tree-sitter/languageParser"
import { readFile } from "fs/promises"
import { Node } from "web-tree-sitter"

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
			const result = await parser["_chunkTextByLines"](lines, "test.js", "hash", "test_type", new Set())

			const segments = result.filter((r) => r.type === "test_type_segment")
			expect(segments.length).toBeGreaterThan(1)
		})

		it("should re-balance chunks when remainder is too small", async () => {
			const lines = Array(100)
				.fill("line with 10 chars")
				.map((_, i) => `${i}: line`)
			const result = await parser["_chunkTextByLines"](lines, "test.js", "hash", "test_type", new Set())

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
})
