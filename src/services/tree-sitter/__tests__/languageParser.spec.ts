// npx vitest services/tree-sitter/__tests__/languageParser.spec.ts

import { loadRequiredLanguageParsers } from "../languageParser"

vi.mock("web-tree-sitter", () => {
	const mockParserInit = vi.fn().mockResolvedValue(undefined)
	const mockLanguageLoad = vi.fn().mockResolvedValue({
		query: vi.fn().mockReturnValue({ id: "mock-query" }),
	})
	const mockSetLanguage = vi.fn()

	// Create a constructor function that also has static methods
	function MockParser() {
		return {
			setLanguage: mockSetLanguage,
		}
	}
	MockParser.init = mockParserInit

	return {
		Parser: MockParser,
		Language: {
			load: mockLanguageLoad,
		},
		// Export the mocks so tests can access them
		__mocks: {
			mockParserInit,
			mockLanguageLoad,
			mockSetLanguage,
		},
	}
})

// Import the mocked module to get access to the mock functions
const { __mocks } = (await import("web-tree-sitter")) as any
const { mockParserInit, mockLanguageLoad, mockSetLanguage } = __mocks

describe("Language Parser", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("loadRequiredLanguageParsers", () => {
		it("should initialize parser only once", async () => {
			const files = ["test.js", "test2.js"]
			await loadRequiredLanguageParsers(files)
			await loadRequiredLanguageParsers(files)

			expect(mockParserInit).toHaveBeenCalledTimes(1)
		})

		it("should load JavaScript parser for .js and .jsx files", async () => {
			const files = ["test.js", "test.jsx"]
			const parsers = await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-javascript.wasm"))
			expect(parsers.js).toBeDefined()
			expect(parsers.jsx).toBeDefined()
			expect(parsers.js.query).toBeDefined()
			expect(parsers.jsx.query).toBeDefined()
		})

		it("should load TypeScript parser for .ts and .tsx files", async () => {
			const files = ["test.ts", "test.tsx"]
			const parsers = await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-typescript.wasm"))
			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-tsx.wasm"))
			expect(parsers.ts).toBeDefined()
			expect(parsers.tsx).toBeDefined()
		})

		it("should load Python parser for .py files", async () => {
			const files = ["test.py"]
			const parsers = await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-python.wasm"))
			expect(parsers.py).toBeDefined()
		})

		it("should load multiple language parsers as needed", async () => {
			const files = ["test.js", "test.py", "test.rs", "test.go"]
			const parsers = await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledTimes(4)
			expect(parsers.js).toBeDefined()
			expect(parsers.py).toBeDefined()
			expect(parsers.rs).toBeDefined()
			expect(parsers.go).toBeDefined()
		})

		it("should handle C/C++ files correctly", async () => {
			const files = ["test.c", "test.h", "test.cpp", "test.hpp"]
			const parsers = await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-c.wasm"))
			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-cpp.wasm"))
			expect(parsers.c).toBeDefined()
			expect(parsers.h).toBeDefined()
			expect(parsers.cpp).toBeDefined()
			expect(parsers.hpp).toBeDefined()
		})

		it("should handle Kotlin files correctly", async () => {
			const files = ["test.kt", "test.kts"]
			const parsers = await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-kotlin.wasm"))
			expect(parsers.kt).toBeDefined()
			expect(parsers.kts).toBeDefined()
			expect(parsers.kt.query).toBeDefined()
			expect(parsers.kts.query).toBeDefined()
		})

		it("should throw error for unsupported file extensions", async () => {
			const files = ["test.unsupported"]

			await expect(loadRequiredLanguageParsers(files)).rejects.toThrow("Unsupported language: unsupported")
		})

		it("should load each language only once for multiple files", async () => {
			const files = ["test1.js", "test2.js", "test3.js"]
			await loadRequiredLanguageParsers(files)

			expect(mockLanguageLoad).toHaveBeenCalledTimes(1)
			expect(mockLanguageLoad).toHaveBeenCalledWith(expect.stringContaining("tree-sitter-javascript.wasm"))
		})

		it("should set language for each parser instance", async () => {
			const files = ["test.js", "test.py"]
			await loadRequiredLanguageParsers(files)

			expect(mockSetLanguage).toHaveBeenCalledTimes(2)
		})
	})
})
