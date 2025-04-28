import * as path from "path"
import Parser from "web-tree-sitter"
import {
	javascriptQuery,
	typescriptQuery,
	tsxQuery,
	pythonQuery,
	rustQuery,
	goQuery,
	cppQuery,
	cQuery,
	csharpQuery,
	rubyQuery,
	javaQuery,
	phpQuery,
	htmlQuery,
	swiftQuery,
	kotlinQuery,
	cssQuery,
	ocamlQuery,
	solidityQuery,
	tomlQuery,
	vueQuery,
	luaQuery,
	systemrdlQuery,
	tlaPlusQuery,
	zigQuery,
	embeddedTemplateQuery,
	elispQuery,
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
		let parserKey = ext // Default to using extension as key
		switch (ext) {
			case "js":
			case "jsx":
			case "json":
				language = await loadLanguage("javascript")
				query = language.query(javascriptQuery)
				break
			case "ts":
				language = await loadLanguage("typescript")
				query = language.query(typescriptQuery)
				break
			case "tsx":
				language = await loadLanguage("tsx")
				query = language.query(tsxQuery)
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
			case "kt":
			case "kts":
				language = await loadLanguage("kotlin")
				query = language.query(kotlinQuery)
				break
			case "css":
				language = await loadLanguage("css")
				query = language.query(cssQuery)
				break
			case "html":
				language = await loadLanguage("html")
				query = language.query(htmlQuery)
				break
			case "ml":
			case "mli":
				language = await loadLanguage("ocaml")
				query = language.query(ocamlQuery)
				break
			case "scala":
				language = await loadLanguage("scala")
				query = language.query(luaQuery) // Temporarily use Lua query until Scala is implemented
				break
			case "sol":
				language = await loadLanguage("solidity")
				query = language.query(solidityQuery)
				break
			case "toml":
				language = await loadLanguage("toml")
				query = language.query(tomlQuery)
				break
			case "vue":
				language = await loadLanguage("vue")
				query = language.query(vueQuery)
				break
			case "lua":
				language = await loadLanguage("lua")
				query = language.query(luaQuery)
				break
			case "rdl":
				language = await loadLanguage("systemrdl")
				query = language.query(systemrdlQuery)
				break
			case "tla":
				language = await loadLanguage("tlaplus")
				query = language.query(tlaPlusQuery)
				break
			case "zig":
				language = await loadLanguage("zig")
				query = language.query(zigQuery)
				break
			case "ejs":
			case "erb":
				language = await loadLanguage("embedded_template")
				parserKey = "embedded_template" // Use same key for both extensions
				query = language.query(embeddedTemplateQuery)
				break
			case "el":
				language = await loadLanguage("elisp")
				query = language.query(elispQuery)
				break
			default:
				throw new Error(`Unsupported language: ${ext}`)
		}
		const parser = new Parser()
		parser.setLanguage(language)
		parsers[parserKey] = { parser, query }
	}
	return parsers
}
