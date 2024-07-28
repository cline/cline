import * as path from "path"
import Parser from "web-tree-sitter"
import {
	javascriptQuery,
	typescriptQuery,
	pythonQuery,
	rustQuery,
	goQuery,
	cppQuery,
	cQuery,
	csharpQuery,
	rubyQuery,
	javaQuery,
	phpQuery,
	swiftQuery,
} from "./queries"

export interface LanguageParser {
	[key: string]: {
		parser: Parser
		query: Parser.Query
	}
}

async function loadLanguage(langName: string) {
	return await Parser.Language.load(path.join(__dirname, `tree-sitter-${langName}.wasm`))
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
	await Parser.init()
	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))
	const parsers: LanguageParser = {}
	for (const ext of extensionsToLoad) {
		let language: Parser.Language
		let query: Parser.Query
		switch (ext) {
			case "js":
			case "jsx":
				language = await loadLanguage("javascript")
				query = language.query(javascriptQuery)
				break
			case "ts":
				language = await loadLanguage("typescript")
				query = language.query(typescriptQuery)
				break
			case "tsx":
				language = await loadLanguage("tsx")
				query = language.query(typescriptQuery)
				break
			case "py":
				language = await loadLanguage("python")
				query = language.query(pythonQuery)
				break
			case "rs":
				language = await loadLanguage("rust")
				query = language.query(rustQuery)
				break
			case "go":
				language = await loadLanguage("go")
				query = language.query(goQuery)
				break
			case "cpp":
			case "hpp":
				language = await loadLanguage("cpp")
				query = language.query(cppQuery)
				break
			case "c":
			case "h":
				language = await loadLanguage("c")
				query = language.query(cQuery)
				break
			case "cs":
				language = await loadLanguage("c_sharp")
				query = language.query(csharpQuery)
				break
			case "rb":
				language = await loadLanguage("ruby")
				query = language.query(rubyQuery)
				break
			case "java":
				language = await loadLanguage("java")
				query = language.query(javaQuery)
				break
			case "php":
				language = await loadLanguage("php")
				query = language.query(phpQuery)
				break
			case "swift":
				language = await loadLanguage("swift")
				query = language.query(swiftQuery)
				break
			default:
				throw new Error(`Unsupported language: ${ext}`)
		}
		const parser = new Parser()
		parser.setLanguage(language)
		parsers[ext] = { parser, query }
	}
	return parsers
}
