import * as path from "path"
import { globby } from "globby"
import * as fs from "fs/promises"
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

async function analyzeProject(dirPath: string): Promise<string> {
	let result = ""

	// Get all files (not gitignored)
	const allFiles = await getAllProjectFiles(dirPath)

	// Separate files to parse and remaining files
	const { filesToParse, remainingFiles } = separateFiles(allFiles)

	// Parse specific files and generate result
	result += "Files parsed with ASTs:\n"
	for (const file of filesToParse) {
		result += `File: ${file}\n`
		const ast = await parseFile(file)
		result += `AST: ${JSON.stringify(ast, null, 2)}\n\n`
	}

	// List remaining files
	result += "Remaining files (not parsed):\n"
	remainingFiles.forEach((file) => {
		result += `${file}\n`
	})

	return result
}

async function getAllProjectFiles(dirPath: string): Promise<string[]> {
	const dirsToIgnore = [
		"node_modules",
		"__pycache__",
		"env",
		"venv",
		"target/dependency",
		"build/dependencies",
		"dist",
		"out",
		"bundle",
		"vendor",
		"tmp",
		"temp",
		"deps",
		"pkg",
		"Pods",
		".*", // '!**/.*' excludes hidden directories, while '!**/.*/**' excludes only their contents. This way we are at least aware of the existence of hidden directories.
	].map((dir) => `**/${dir}/**`)

	const options = {
		cwd: dirPath,
		dot: true, // do not ignore hidden files/directories
		absolute: true,
		markDirectories: true,
		gitignore: true, // globby ignores any files that are gitignored
		ignore: dirsToIgnore, // just in case there is no gitignore, we ignore sensible defaults
	}
	// * globs all files in one dir, ** globs files in nested directories
	const files = await globby("**", options)
	return files
}

function separateFiles(allFiles: string[]): { filesToParse: string[]; remainingFiles: string[] } {
	const extensions = [
		"js",
		"jsx",
		"ts",
		"tsx",
		"py",
		// Rust
		"rs",
		"go",
		// C
		"c",
		"h",
		// C++
		"cpp",
		"hpp",
		// C#
		"cs",
		// Ruby
		"rb",
		"java",
		"php",
		"swift",
	].map((e) => `.${e}`)
	const filesToParse = allFiles.filter((file) => extensions.includes(path.extname(file)))
	const remainingFiles = allFiles.filter((file) => !extensions.includes(path.extname(file)))
	return { filesToParse, remainingFiles }
}

/*
Parsing files using tree-sitter

1. Parse the file content into an AST (Abstract Syntax Tree) using the appropriate language grammar (set of rules that define how the components of a language like keywords, expressions, and statements can be combined to create valid programs).
2. Create a query using a language-specific query string, and run it against the AST's root node to capture specific syntax elements.
    - We use tag queries to identify named entities in a program, and then use a syntax capture to label the entity and its name. A notable example of this is GitHub's search-based code navigation.
3. Sort the captures by their position in the file, and format the output by iterating through the captures by i.e. adding "|----\n" for gaps between captured sections.

This approach allows us to focus on the most relevant parts of the code (defined by our language-specific queries) and provides a concise yet informative view of the file's structure and key elements.

- https://github.com/tree-sitter/node-tree-sitter/blob/master/test/query_test.js
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/helper.js
- https://tree-sitter.github.io/tree-sitter/code-navigation-systems
*/
async function parseFile(filePath: string): Promise<string> {
	const fileContent = await fs.readFile(filePath, "utf8")
	const ext = path.extname(filePath).toLowerCase().slice(1)
	await Parser.init()
	const parser = new Parser()
	let query: Parser.Query

	switch (ext) {
		case "js":
		case "jsx":
			const JavaScript = await loadLanguage("javascript")
			parser.setLanguage(JavaScript)
			query = JavaScript.query(javascriptQuery)
			break
		case "ts":
			const TypeScript = await loadLanguage("typescript")
			parser.setLanguage(TypeScript)
			query = TypeScript.query(typescriptQuery)
			break
		case "tsx":
			const Tsx = await loadLanguage("tsx")
			parser.setLanguage(Tsx)
			query = Tsx.query(typescriptQuery)
			break
		case "py":
			const Python = await loadLanguage("python")
			parser.setLanguage(Python)
			query = Python.query(pythonQuery)
			break
		case "rs":
			const Rust = await loadLanguage("rust")
			parser.setLanguage(Rust)
			query = Rust.query(rustQuery)
			break
		case "go":
			const Go = await loadLanguage("go")
			parser.setLanguage(Go)
			query = Go.query(goQuery)
			break
		case "cpp":
		case "hpp":
			const Cpp = await loadLanguage("cpp")
			parser.setLanguage(Cpp)
			query = Cpp.query(cppQuery)
			break
		case "c":
		case "h":
			const C = await loadLanguage("c")
			parser.setLanguage(C)
			query = C.query(cQuery)
			break
		case "cs":
			const CSharp = await loadLanguage("c_sharp")
			parser.setLanguage(CSharp)
			query = CSharp.query(csharpQuery)
			break
		case "rb":
			const Ruby = await loadLanguage("ruby")
			parser.setLanguage(Ruby)
			query = Ruby.query(rubyQuery)
			break
		case "java":
			const Java = await loadLanguage("java")
			parser.setLanguage(Java)
			query = Java.query(javaQuery)
			break
		case "php":
			const PHP = await loadLanguage("php")
			parser.setLanguage(PHP)
			query = PHP.query(phpQuery)
			break
		case "swift":
			const Swift = await loadLanguage("swift")
			parser.setLanguage(Swift)
			query = Swift.query(swiftQuery)
			break
		default:
			return `Unsupported file type: ${filePath}`
	}

	let formattedOutput = `${filePath}:\n|----\n`

	try {
		// Parse the file content into an Abstract Syntax Tree (AST), a tree-like representation of the code
		const tree = parser.parse(fileContent)

		// Apply the query to the AST and get the captures
		// Captures are specific parts of the AST that match our query patterns, each capture represents a node in the AST that we're interested in.
		const captures = query.captures(tree.rootNode)

		// Sort captures by their start position
		captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

		// Split the file content into individual lines
		const lines = fileContent.split("\n")

		// Keep track of the last line we've processed
		let lastLine = -1

		captures.forEach((capture) => {
			const { node } = capture
			// Get the start and end lines of the current AST node
			const startLine = node.startPosition.row
			const endLine = node.endPosition.row

			// Add separator if there's a gap between captures
			if (lastLine !== -1 && startLine > lastLine + 1) {
				formattedOutput += "|----\n"
			}

			// Add the captured lines
			for (let i = startLine; i <= endLine; i++) {
				formattedOutput += `│${lines[i]}\n`
			}

			lastLine = endLine
		})
	} catch (error) {
		formattedOutput += `Error parsing file: ${error}\n`
	}

	formattedOutput += "|----\n"

	return formattedOutput
}

async function loadLanguage(langName: string) {
	return await Parser.Language.load(path.join(__dirname, `tree-sitter-${langName}.wasm`))
}

export { analyzeProject }
