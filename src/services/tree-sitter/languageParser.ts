import * as path from "path"
import Parser from "web-tree-sitter"
import * as queries from "./queries"

export interface CodeDefinition {
	name: string
	type: "class" | "method" | "function" | "interface" | "module"
	startLine: number
	endLine: number
	references: string[] // Names of other definitions this one references
	referencedBy: string[] // Names of definitions that reference this one
	filePath: string // The file this definition is in
	importedBy: string[] // Files that import this definition
	rank: number // Calculated importance score
	metrics: {
		referenceCount: number // How many times it's referenced
		importCount: number // How many files import it
		complexity: number // Rough measure of definition complexity
		conversationMentions: number // Number of times mentioned in conversation
		lastMentionedTs: number // Timestamp of last mention in conversation
		recentViewCount: number // Number of times file was viewed recently
		lastViewedTs: number // Timestamp of last view
	}
}

export interface ImportInfo {
	source: string // The importing file
	target: string // The imported file/module
	importedSymbols: string[] // Specific symbols imported, if available
	isTypeOnly?: boolean // Whether it's a type-only import (TypeScript)
}

export interface FileAnalysis {
	definitions: CodeDefinition[]
	imports: ImportInfo[] // Changed from string[] to ImportInfo[]
	exportedSymbols: string[] // Track what the file exports
}

export interface LanguageParser {
	[key: string]: {
		parser: Parser
		query: Parser.Query
		importQuery?: Parser.Query // Added for import analysis
	}
}

async function loadLanguage(langName: string) {
	return await Parser.Language.load(path.join(__dirname, "wasm", `tree-sitter-${langName}.wasm`))
}

let isParserInitialized = false

async function initializeParser() {
	if (!isParserInitialized) {
		await Parser.init()
		isParserInitialized = true
	}
}

/*
Using node bindings for tree-sitter is problematic in vscode extensions 
because of incompatibility with electron. Going the .wasm route has the 
advantage of not having to build for multiple architectures.

We use web-tree-sitter and tree-sitter-wasms which provides auto-updating prebuilt WASM binaries for tree-sitter's language parsers.

This function loads WASM modules for relevant language parsers based on input files:
1. Extracts unique file extensions
2. Maps extensions to language names
3. Loads corresponding WASM files (containing grammar rules)
4. Uses WASM modules to initialize tree-sitter parsers

This approach optimizes performance by loading only necessary parsers once for all relevant files.

Sources:
- https://github.com/tree-sitter/node-tree-sitter/issues/169
- https://github.com/tree-sitter/node-tree-sitter/issues/168
- https://github.com/Gregoor/tree-sitter-wasms/blob/main/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
*/
export async function loadRequiredLanguageParsers(filesToParse: string[]): Promise<LanguageParser> {
	await initializeParser()
	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
	const parsers: LanguageParser = {}
	for (const ext of extensionsToLoad) {
		let language: Parser.Language
		let query: Parser.Query
		let importQuery: Parser.Query | undefined

		switch (ext) {
			case "js":
			case "jsx":
				language = await loadLanguage("javascript")
				query = language.query(queries.javascriptQuery)
				importQuery = language.query(queries.javascriptImports)
				break
			case "ts":
			case "tsx":
				language = await loadLanguage("typescript")
				query = language.query(queries.typescriptQuery)
				importQuery = language.query(queries.typescriptImports)
				break
			case "py":
				language = await loadLanguage("python")
				query = language.query(queries.pythonQuery)
				importQuery = language.query(queries.pythonImports)
				break
			case "go":
				language = await loadLanguage("go")
				query = language.query(queries.goQuery)
				importQuery = language.query(queries.goImports)
				break
			case "java":
				language = await loadLanguage("java")
				query = language.query(queries.javaQuery)
				importQuery = language.query(queries.javaImports)
				break
			case "rs":
				language = await loadLanguage("rust")
				query = language.query(queries.rustQuery)
				importQuery = language.query(queries.rustImports)
				break
			case "cpp":
			case "hpp":
				language = await loadLanguage("cpp")
				query = language.query(queries.cppQuery)
				importQuery = language.query(queries.cppImports)
				break
			case "c":
			case "h":
				language = await loadLanguage("c")
				query = language.query(queries.cQuery)
				importQuery = language.query(queries.cImports)
				break
			case "cs":
				language = await loadLanguage("c_sharp")
				query = language.query(queries.csharpQuery)
				importQuery = language.query(queries.csharpImports)
				break
			case "rb":
				language = await loadLanguage("ruby")
				query = language.query(queries.rubyQuery)
				importQuery = language.query(queries.rubyImports)
				break
			case "php":
				language = await loadLanguage("php")
				query = language.query(queries.phpQuery)
				importQuery = language.query(queries.phpImports)
				break
			case "swift":
				language = await loadLanguage("swift")
				query = language.query(queries.swiftQuery)
				importQuery = language.query(queries.swiftImports)
				break
			default:
				throw new Error(`Unsupported language: ${ext}`)
		}
		const parser = new Parser()
		parser.setLanguage(language)
		parsers[ext] = { parser, query, importQuery }
	}
	return parsers
}
