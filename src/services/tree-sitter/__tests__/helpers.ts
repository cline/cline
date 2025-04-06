import { jest } from "@jest/globals"
import { parseSourceCodeDefinitionsForFile } from ".."
import * as fs from "fs/promises"
import * as path from "path"
import Parser from "web-tree-sitter"
import tsxQuery from "../queries/tsx"

// Global debug flag - read from environment variable or default to 0
export const DEBUG = process.env.DEBUG ? parseInt(process.env.DEBUG, 10) : 0

// Debug function to conditionally log messages
export const debugLog = (message: string, ...args: any[]) => {
	if (DEBUG) {
		console.debug(message, ...args)
	}
}

// Mock fs module
const mockedFs = jest.mocked(fs)

// Store the initialized TreeSitter for reuse
let initializedTreeSitter: Parser | null = null

// Function to initialize tree-sitter
export async function initializeTreeSitter() {
	if (initializedTreeSitter) {
		return initializedTreeSitter
	}

	const TreeSitter = await initializeWorkingParser()
	const wasmPath = path.join(process.cwd(), "dist/tree-sitter-tsx.wasm")
	const tsxLang = await TreeSitter.Language.load(wasmPath)

	initializedTreeSitter = TreeSitter
	return TreeSitter
}

// Function to initialize a working parser with correct WASM path
// DO NOT CHANGE THIS FUNCTION
export async function initializeWorkingParser() {
	const TreeSitter = jest.requireActual("web-tree-sitter") as any

	// Initialize directly using the default export or the module itself
	const ParserConstructor = TreeSitter.default || TreeSitter
	await ParserConstructor.init()

	// Override the Parser.Language.load to use dist directory
	const originalLoad = TreeSitter.Language.load
	TreeSitter.Language.load = async (wasmPath: string) => {
		const filename = path.basename(wasmPath)
		const correctPath = path.join(process.cwd(), "dist", filename)
		// console.log(`Redirecting WASM load from ${wasmPath} to ${correctPath}`)
		return originalLoad(correctPath)
	}

	return TreeSitter
}

// Test helper for parsing source code definitions
export async function testParseSourceCodeDefinitions(
	testFilePath: string,
	content: string,
	options: {
		language?: string
		wasmFile?: string
		queryString?: string
		extKey?: string
	} = {},
): Promise<string | undefined> {
	// Set default options
	const language = options.language || "tsx"
	const wasmFile = options.wasmFile || "tree-sitter-tsx.wasm"
	const queryString = options.queryString || tsxQuery
	const extKey = options.extKey || "tsx"

	// Clear any previous mocks
	jest.clearAllMocks()

	// Mock fs.readFile to return our sample content
	mockedFs.readFile.mockResolvedValue(content)

	// Get the mock function
	const mockedLoadRequiredLanguageParsers = require("../languageParser").loadRequiredLanguageParsers

	// Initialize TreeSitter and create a real parser
	const TreeSitter = await initializeTreeSitter()
	const parser = new TreeSitter()

	// Load language and configure parser
	const wasmPath = path.join(process.cwd(), `dist/${wasmFile}`)
	const lang = await TreeSitter.Language.load(wasmPath)
	parser.setLanguage(lang)

	// Create a real query
	const query = lang.query(queryString)

	// Set up our language parser with real parser and query
	const mockLanguageParser: any = {}
	mockLanguageParser[extKey] = { parser, query }

	// Configure the mock to return our parser
	mockedLoadRequiredLanguageParsers.mockResolvedValue(mockLanguageParser)

	// Call the function under test
	const result = await parseSourceCodeDefinitionsForFile(testFilePath)

	// Verify loadRequiredLanguageParsers was called with the expected file path
	expect(mockedLoadRequiredLanguageParsers).toHaveBeenCalledWith([testFilePath])
	expect(mockedLoadRequiredLanguageParsers).toHaveBeenCalled()

	debugLog(`content:\n${content}\n\nResult:\n${result}`)
	return result
}

// Helper function to inspect tree structure
export async function inspectTreeStructure(content: string, language: string = "typescript"): Promise<void> {
	const TreeSitter = await initializeTreeSitter()
	const parser = new TreeSitter()
	const wasmPath = path.join(process.cwd(), `dist/tree-sitter-${language}.wasm`)
	const lang = await TreeSitter.Language.load(wasmPath)
	parser.setLanguage(lang)

	// Parse the content
	const tree = parser.parse(content)

	// Print the tree structure
	debugLog(`TREE STRUCTURE (${language}):\n${tree.rootNode.toString()}`)

	// Add more detailed debug information
	debugLog("\nDETAILED NODE INSPECTION:")

	// Function to recursively print node details
	const printNodeDetails = (node: Parser.SyntaxNode, depth: number = 0) => {
		const indent = "  ".repeat(depth)
		debugLog(
			`${indent}Node Type: ${node.type}, Start: ${node.startPosition.row}:${node.startPosition.column}, End: ${node.endPosition.row}:${node.endPosition.column}`,
		)

		// Print children
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				// For type_alias_declaration nodes, print more details
				if (node.type === "type_alias_declaration") {
					debugLog(`${indent}  TYPE ALIAS: ${node.text}`)
				}

				// For conditional_type nodes, print more details
				if (node.type === "conditional_type" || child.type === "conditional_type") {
					debugLog(`${indent}  CONDITIONAL TYPE FOUND: ${child.text}`)
				}

				// For infer_type nodes, print more details
				if (node.type === "infer_type" || child.type === "infer_type") {
					debugLog(`${indent}  INFER TYPE FOUND: ${child.text}`)
				}

				printNodeDetails(child, depth + 1)
			}
		}
	}

	// Start recursive printing from the root node
	printNodeDetails(tree.rootNode)
}
