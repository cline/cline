import * as fs from "fs/promises"
import type { Mock } from "vitest"

import { parseSourceCodeForDefinitionsTopLevel } from "../index"
import { listFiles } from "../../glob/list-files"
import { loadRequiredLanguageParsers } from "../languageParser"
import { fileExistsAtPath } from "../../../utils/fs"

// Mock dependencies
vi.mock("../../glob/list-files")
vi.mock("../languageParser")
vi.mock("../../../utils/fs")
vi.mock("fs/promises")

describe("Tree-sitter Service", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(fileExistsAtPath as Mock).mockResolvedValue(true)
	})

	describe("parseSourceCodeForDefinitionsTopLevel", () => {
		it("should handle non-existent directory", async () => {
			;(fileExistsAtPath as Mock).mockResolvedValue(false)

			const result = await parseSourceCodeForDefinitionsTopLevel("/non/existent/path")
			expect(result).toBe("This directory does not exist or you do not have permission to access it.")
		})

		it("should handle empty directory", async () => {
			;(listFiles as Mock).mockResolvedValue([[], new Set()])

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")
			expect(result).toBe("No source code definitions found.")
		})

		it("should parse TypeScript files correctly", async () => {
			const mockFiles = ["/test/path/file1.ts", "/test/path/file2.tsx", "/test/path/readme.md"]

			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: vi.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: vi.fn().mockReturnValue([
					{
						// Must span 4 lines to meet MIN_COMPONENT_LINES
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 3 },
							parent: {
								startPosition: { row: 0 },
								endPosition: { row: 3 },
							},
							text: () => "export class TestClass",
						},
						name: "name.definition",
					},
				]),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
				tsx: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as Mock).mockResolvedValue("export class TestClass {\n  constructor() {}\n}")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			expect(result).toContain("file1.ts")
			expect(result).toContain("file2.tsx")
			expect(result).not.toContain("readme.md")
			expect(result).toContain("export class TestClass")
		})

		it("should handle multiple definition types", async () => {
			const mockFiles = ["/test/path/file.ts"]
			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: vi.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: vi.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 3 },
							parent: {
								startPosition: { row: 0 },
								endPosition: { row: 3 },
							},
							text: () => "class TestClass",
						},
						name: "name.definition.class",
					},
					{
						node: {
							startPosition: { row: 2 },
							endPosition: { row: 5 },
							parent: {
								startPosition: { row: 2 },
								endPosition: { row: 5 },
							},
							text: () => "testMethod()",
						},
						name: "name.definition.function",
					},
				]),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})

			const fileContent = "class TestClass {\n" + "  constructor() {}\n" + "  testMethod() {}\n" + "}"

			;(fs.readFile as Mock).mockResolvedValue(fileContent)

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			expect(result).toContain("class TestClass")
			expect(result).toContain("testMethod()")
		})

		it("should handle parsing errors gracefully", async () => {
			const mockFiles = ["/test/path/file.ts"]
			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: vi.fn().mockImplementation(() => {
					throw new Error("Parsing error")
				}),
			}

			const mockQuery = {
				captures: vi.fn(),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as Mock).mockResolvedValue("invalid code")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")
			expect(result).toBe("No source code definitions found.")
		})

		it("should capture arrow functions in JSX attributes with 4+ lines", async () => {
			const mockFiles = ["/test/path/jsx-arrow.tsx"]
			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			// Embed the fixture content directly
			const fixtureContent = `import React from 'react';

export const CheckboxExample = () => (
		<VSCodeCheckbox
		  checked={isCustomTemperature}
		  onChange={(e: any) => {
		    const isChecked = e.target.checked
		    setIsCustomTemperature(isChecked)
		
		    if (!isChecked) {
		      setInputValue(null) // Unset the temperature
		    } else {
		      setInputValue(value ?? 0) // Use value from config
		    }
		  }}>
		  <label className="block font-medium mb-1">
		    {t("settings:temperature.useCustom")}
		  </label>
		</VSCodeCheckbox>
);`
			;(fs.readFile as Mock).mockResolvedValue(fixtureContent)

			const lines = fixtureContent.split("\n")

			// Define the node type for proper TypeScript support
			interface TreeNode {
				type?: string
				toString?: () => string
				text?: () => string
				startPosition?: { row: number }
				endPosition?: { row: number }
				children?: TreeNode[]
				fields?: () => Record<string, any>
				printTree?: (depth?: number) => string
			}

			// Create a more detailed mock rootNode for debugging Tree-sitter structure
			// Helper function to print tree nodes
			const printTree = (node: TreeNode, depth = 0): string => {
				let result = ""
				const indent = "  ".repeat(depth)

				// Print node details
				result += `${indent}Type: ${node.type || "ROOT"}\n`
				result += `${indent}Text: "${node.text ? node.text() : "root"}"`

				// Print fields if available
				if (node.fields) {
					result += "\n" + indent + "Fields: " + JSON.stringify(node.fields(), null, 2)
				}

				// Print children recursively
				if (node.children && node.children.length > 0) {
					result += "\n" + indent + "Children:"
					for (const child of node.children) {
						result += "\n" + printTree(child, depth + 1)
					}
				}

				return result
			}

			const mockRootNode: TreeNode = {
				toString: () => fixtureContent,
				text: () => fixtureContent,
				printTree: function (depth = 0) {
					return printTree(this, depth)
				},
				children: [
					{
						type: "class_declaration",
						text: () => "class TestComponent extends React.Component",
						startPosition: { row: 0 },
						endPosition: { row: 20 },
						printTree: function (depth = 0) {
							return printTree(this, depth)
						},
						children: [
							{
								type: "type_identifier",
								text: () => "TestComponent",
								printTree: function (depth = 0) {
									return printTree(this, depth)
								},
							},
							{
								type: "extends_clause",
								text: () => "extends React.Component",
								printTree: function (depth = 0) {
									return printTree(this, depth)
								},
								children: [
									{
										type: "generic_type",
										text: () => "React.Component",
										children: [{ type: "member_expression", text: () => "React.Component" }],
									},
								],
							},
						],
						// Debug output to see field names
						fields: () => {
							return {
								name: [{ type: "type_identifier", text: () => "TestComponent" }],
								class_heritage: [{ type: "extends_clause", text: () => "extends React.Component" }],
							}
						},
					},
				],
			}

			const mockParser = {
				parse: vi.fn().mockReturnValue({
					rootNode: mockRootNode,
				}),
			}

			const mockQuery = {
				captures: vi.fn().mockImplementation(() => {
					// Log tree structure for debugging
					console.log("TREE STRUCTURE:")
					if (mockRootNode.printTree) {
						console.log(mockRootNode.printTree())
					} else {
						console.log("Tree structure:", JSON.stringify(mockRootNode, null, 2))
					}

					return [
						{
							node: {
								startPosition: { row: 4 },
								endPosition: { row: 14 },
								text: () => lines[4],
								parent: {
									startPosition: { row: 4 },
									endPosition: { row: 14 },
									text: () => lines[4],
								},
							},
							name: "definition.lambda",
						},
					]
				}),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
				tsx: { parser: mockParser, query: mockQuery },
			})

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			// Verify function found and correctly parsed
			expect(result).toContain("jsx-arrow.tsx")
			expect(result).toContain("5--15 |")

			// Verify line count
			const capture = mockQuery.captures.mock.results[0].value[0]
			expect(capture.node.endPosition.row - capture.node.startPosition.row).toBeGreaterThanOrEqual(4)
		})

		it("should respect file limit", async () => {
			const mockFiles = Array(100)
				.fill(0)
				.map((_, i) => `/test/path/file${i}.ts`)
			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: vi.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: vi.fn().mockReturnValue([]),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
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

			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: vi.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: vi.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 3 },
							parent: {
								startPosition: { row: 0 },
								endPosition: { row: 3 },
							},
							text: () => "function test() {}",
						},
						name: "name",
					},
				]),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
				js: { parser: mockParser, query: mockQuery },
				py: { parser: mockParser, query: mockQuery },
				rs: { parser: mockParser, query: mockQuery },
				cpp: { parser: mockParser, query: mockQuery },
				go: { parser: mockParser, query: mockQuery },
				kt: { parser: mockParser, query: mockQuery },
				kts: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as Mock).mockResolvedValue("function test() {}")

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
			;(listFiles as Mock).mockResolvedValue([mockFiles, new Set()])

			const mockParser = {
				parse: vi.fn().mockReturnValue({
					rootNode: "mockNode",
				}),
			}

			const mockQuery = {
				captures: vi.fn().mockReturnValue([
					{
						node: {
							startPosition: { row: 0 },
							endPosition: { row: 3 },
							parent: {
								startPosition: { row: 0 },
								endPosition: { row: 3 },
							},
							text: () => "class Test {}",
						},
						name: "name",
					},
				]),
			}

			;(loadRequiredLanguageParsers as Mock).mockResolvedValue({
				ts: { parser: mockParser, query: mockQuery },
			})
			;(fs.readFile as Mock).mockResolvedValue("class Test {}")

			const result = await parseSourceCodeForDefinitionsTopLevel("/test/path")

			// Should use forward slashes regardless of platform
			expect(result).toContain("dir/file.ts")
			expect(result).not.toContain("dir\\file.ts")
		})
	})
})
