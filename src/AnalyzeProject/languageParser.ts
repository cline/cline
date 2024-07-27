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
} from "./tree-sitter-queries/tags"

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
*/
export async function loadAllLanguages(filesToParse: string[]): Promise<LanguageParser> {
	await Parser.init()

	const extensionsToLoad = new Set(filesToParse.map((file) => path.extname(file).toLowerCase().slice(1)))

	const languageMap: { [key: string]: string } = {
		js: "javascript",
		jsx: "javascript",
		ts: "typescript",
		tsx: "tsx",
		py: "python",
		rs: "rust",
		go: "go",
		cpp: "cpp",
		hpp: "cpp",
		c: "c",
		h: "c",
		cs: "c_sharp",
		rb: "ruby",
		java: "java",
		php: "php",
		swift: "swift",
	}

	const languages: { [key: string]: Parser.Language } = {}

	for (const ext of extensionsToLoad) {
		if (ext in languageMap) {
			const langName = languageMap[ext as keyof typeof languageMap]
			if (!languages[langName]) {
				languages[langName] = await loadLanguage(langName)
			}
		}
	}

	const parsers: LanguageParser = {}

	for (const ext of extensionsToLoad) {
		if (ext in languageMap) {
			const langName = languageMap[ext as keyof typeof languageMap]
			const lang = languages[langName]

			const parser = new Parser()
			parser.setLanguage(lang)
			let query: Parser.Query

			switch (ext) {
				case "js":
				case "jsx":
					query = lang.query(javascriptQuery)
					break
				case "ts":
				case "tsx":
					query = lang.query(typescriptQuery)
					break
				case "py":
					query = lang.query(pythonQuery)
					break
				case "rs":
					query = lang.query(rustQuery)
					break
				case "go":
					query = lang.query(goQuery)
					break
				case "cpp":
				case "hpp":
					query = lang.query(cppQuery)
					break
				case "c":
				case "h":
					query = lang.query(cQuery)
					break
				case "cs":
					query = lang.query(csharpQuery)
					break
				case "rb":
					query = lang.query(rubyQuery)
					break
				case "java":
					query = lang.query(javaQuery)
					break
				case "php":
					query = lang.query(phpQuery)
					break
				case "swift":
					query = lang.query(swiftQuery)
					break
				default:
					throw new Error(`Unsupported language: ${ext}`)
			}

			parsers[ext] = { parser, query }
		}
	}

	return parsers
}
