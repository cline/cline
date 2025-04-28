import { jest } from "@jest/globals"
import { parseSourceCodeDefinitionsForFile, setMinComponentLines } from ".."
import * as fs from "fs/promises"
import * as path from "path"
import Parser from "web-tree-sitter"
import tsxQuery from "../queries/tsx"
// Mock setup
jest.mock("fs/promises")
export const mockedFs = jest.mocked(fs)

jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockImplementation(() => Promise.resolve(true)),
}))

jest.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: jest.fn(),
}))

// Global debug flag - read from environment variable or default to 0
export const DEBUG = process.env.DEBUG ? parseInt(process.env.DEBUG, 10) : 0

// Debug function to conditionally log messages
export const debugLog = (message: string, ...args: any[]) => {
	if (DEBUG) {
		console.debug(message, ...args)
	}
}

// Store the initialized TreeSitter for reuse
let initializedTreeSitter: Parser | null = null

// Function to initialize tree-sitter
export async function initializeTreeSitter() {
	if (initializedTreeSitter) {
		return initializedTreeSitter
	}

	const TreeSitter = await initializeWorkingParser()

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
	// Set minimum component lines to 0 for tests
	setMinComponentLines(0)

	// Set default options
	const wasmFile = options.wasmFile || "tree-sitter-tsx.wasm"
	const queryString = options.queryString || tsxQuery
	const extKey = options.extKey || "tsx"

	// Clear any previous mocks and set up fs mock
	jest.clearAllMocks()
	jest.mock("fs/promises")
	const mockedFs = require("fs/promises") as jest.Mocked<typeof import("fs/promises")>
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

	debugLog(`Result:\n${result}`)
	return result
}

// Helper function to inspect tree structure
export async function inspectTreeStructure(content: string, language: string = "typescript"): Promise<string> {
	const TreeSitter = await initializeTreeSitter()
	const parser = new TreeSitter()
	const wasmPath = path.join(process.cwd(), `dist/tree-sitter-${language}.wasm`)
	const lang = await TreeSitter.Language.load(wasmPath)
	parser.setLanguage(lang)

	// Parse the content
	const tree = parser.parse(content)

	// Print the tree structure
	debugLog(`TREE STRUCTURE (${language}):\n${tree.rootNode.toString()}`)
	return tree.rootNode.toString()
}
