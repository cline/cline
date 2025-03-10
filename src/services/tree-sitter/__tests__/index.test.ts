import { parseSourceCodeForDefinitionsTopLevel } from "../index"
import { listFiles } from "../../glob/list-files"
import { loadRequiredLanguageParsers } from "../languageParser"
import { fileExistsAtPath } from "../../../utils/fs"
import * as fs from "fs/promises"
import * as path from "path"

// Mock dependencies
jest.mock("../../glob/list-files")
jest.mock("../languageParser")
jest.mock("../../../utils/fs")
jest.mock("fs/promises")

describe("Tree-sitter Service", () => {
	beforeEach(() => {
		jest.clearAllMocks()
		;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
	})

	describe("parseSourceCodeForDefinitionsTopLevel", () => {
		it("should handle non-existent directory", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			const result = await parseSourceCodeForDefinitionsTopLevel("/non/existent/path")
			expect(result).toBe("This directory does not exist or you do not have permission to access it.")
		})

		it("should handle empty directory", async () => {
			;(listFiles as jest.Mock).mockResolvedValue([[], new Set()])

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")
			expect(result).toBe("No source code definitions found.")
		})

		it("should parse TypeScript files correctly", async () => {
			const mockFiles = ["/test/path/file1.ts", "/test/path/file2.tsx", "/test/path/readme.md"]

			;(listFiles as jest.Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: jest.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: jest.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 0 },
						},
						name: "name.definition",
					},
				]),
			}

			;(loadRequiredLanguageParsers as jest.Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
				tsx: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as jest.Mock).mockResolvedValue("export class TestClass {\n  constructor() {}\n}")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			expect(result).toContain("file1.ts")
			expect(result).toContain("file2.tsx")
			expect(result).not.toContain("readme.md")
			expect(result).toContain("export class TestClass")
		})

		it("should handle multiple definition types", async () => {
			const mockFiles = ["/test/path/file.ts"]
			;(listFiles as jest.Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: jest.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: jest.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 0 },
						},
						name: "name.definition.class",
					},
					{
						node: {
							startPosition: { row: 2 },
							endPosition: { row: 2 },
						},
						name: "name.definition.function",
					},
				]),
			}

			;(loadRequiredLanguageParsers as jest.Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})

			const fileContent = "class TestClass {\n" + "  constructor() {}\n" + "  testMethod() {}\n" + "}"

			;(fs.readFile as jest.Mock).mockResolvedValue(fileContent)

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			expect(result).toContain("class TestClass")
			expect(result).toContain("testMethod()")
			expect(result).toContain("|----")
		})

		it("should handle parsing errors gracefully", async () => {
			const mockFiles = ["/test/path/file.ts"]
			;(listFiles as jest.Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: jest.fn().mockImplementation(() => {
					throw new Error("Parsing error")
				}),
			}

			const mockQuery = {
				captures: jest.fn(),
			}

			;(loadRequiredLanguageParsers as jest.Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as jest.Mock).mockResolvedValue("invalid code")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")
			expect(result).toBe("No source code definitions found.")
		})

		it("should respect file limit", async () => {
			const mockFiles = Array(100)
				.fill(0)
				.map((_, i) => `/test/path/file${i}.ts`)
			;(listFiles as jest.Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: jest.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: jest.fn().mockReturnValue([]),
			}

			;(loadRequiredLanguageParsers as jest.Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})

			await parseSourceCodeForDefinitionsTopLevel("/test/path")

			// Should only process first 50 files
			expect(mockParser.parse).toHaveBeenCalledTimes(50)
		})

		it("should handle various supported file extensions", async () => {
			const mockFiles = [
				"/test/path/script.js",
				"/test/path/app.py",
				"/test/path/main.rs",
				"/test/path/program.cpp",
				"/test/path/code.go",
				"/test/path/app.kt",
				"/test/path/script.kts",
			]

			;(listFiles as jest.Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: jest.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: jest.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 0 },
						},
						name: "name",
					},
				]),
			}

			;(loadRequiredLanguageParsers as jest.Mock).mockResolvedValue({
				js: { parser: mockParser, query: mockQuery },
				py: { parser: mockParser, query: mockQuery },
				rs: { parser: mockParser, query: mockQuery },
				cpp: { parser: mockParser, query: mockQuery },
				go: { parser: mockParser, query: mockQuery },
				kt: { parser: mockParser, query: mockQuery },
				kts: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as jest.Mock).mockResolvedValue("function test() {}")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			expect(result).toContain("script.js")
			expect(result).toContain("app.py")
			expect(result).toContain("main.rs")
			expect(result).toContain("program.cpp")
			expect(result).toContain("code.go")
			expect(result).toContain("app.kt")
			expect(result).toContain("script.kts")
		})

		it("should normalize paths in output", async () => {
			const mockFiles = ["/test/path/dir\\file.ts"]
			;(listFiles as jest.Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: jest.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: jest.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 0 },
						},
						name: "name",
					},
				]),
			}

			;(loadRequiredLanguageParsers as jest.Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as jest.Mock).mockResolvedValue("class Test {}")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			// Should use forward slashes regardless of platform
			expect(result).toContain("dir/file.ts")
			expect(result).not.toContain("dir\\file.ts")
		})
	})
})
