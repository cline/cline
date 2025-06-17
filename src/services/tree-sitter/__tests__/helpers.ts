import { parseSourceCodeDefinitionsForFile, setMinComponentLines } from ".."
import * as fs from "fs/promises"
import * as path from "path"
import tsxQuery from "../queries/tsx"
import { Parser, Language } from "web-tree-sitter"

vi.mock("fs/promises")
export const mockedFs = vi.mocked(fs)

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => Promise.resolve(true)),
}))

vi.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: vi.fn(),
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
let initializedTreeSitter: { Parser: typeof Parser; Language: typeof Language } | null = null

// Function to initialize tree-sitter
export async function initializeTreeSitter() {
	if (!initializedTreeSitter) {
		// Initialize directly using the default export or the module itself
		await Parser.init()

		// Override the Parser.Language.load to use dist directory
		const originalLoad = Language.load

		Language.load = async (wasmPath: string) => {
			const filename = path.basename(wasmPath)
			const correctPath = path.join(process.cwd(), "dist", filename)
			// console.log(`Redirecting WASM load from ${wasmPath} to ${correctPath}`)
			return originalLoad(correctPath)
		}

		initializedTreeSitter = { Parser, Language }
	}

	return initializedTreeSitter
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
	vi.clearAllMocks()
	vi.mock("fs/promises")
	const mockedFs = (await vi.importActual("fs/promises")) as typeof import("fs/promises")
	;(fs.readFile as any).mockResolvedValue(content)

	// Get the mock function
	const { loadRequiredLanguageParsers } = await import("../languageParser")
	const mockedLoadRequiredLanguageParsers = loadRequiredLanguageParsers as any

	// Initialize TreeSitter and create a real parser
	const { Parser, Language } = await initializeTreeSitter()
	const parser = new Parser()

	// Load language and configure parser
	const wasmPath = path.join(process.cwd(), `dist/${wasmFile}`)
	const lang = await Language.load(wasmPath)
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
	const { Parser, Language } = await initializeTreeSitter()
	const parser = new Parser()
	const wasmPath = path.join(process.cwd(), `dist/tree-sitter-${language}.wasm`)
	const lang = await Language.load(wasmPath)
	parser.setLanguage(lang)

	// Parse the content
	const tree = parser.parse(content)

	// Print the tree structure
	debugLog(`TREE STRUCTURE (${language}):\n${tree?.rootNode.toString()}`)
	return tree?.rootNode.toString() || ""
}
