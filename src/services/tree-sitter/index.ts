import * as fs from "fs/promises"
import * as path from "path"
import { listFiles } from "../glob/list-files"
import { LanguageParser, loadRequiredLanguageParsers } from "./languageParser"
import { fileExistsAtPath } from "../../utils/fs"
import { ClineIgnoreController } from "../../core/ignore/ClineIgnoreController"

// TODO: implement caching behavior to avoid having to keep analyzing project for new tasks.
export async function parseSourceCodeForDefinitionsTopLevel(
	dirPath: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string> {
	// check if the path exists
	const dirExists = await fileExistsAtPath(path.resolve(dirPath))
	if (!dirExists) {
		return "This directory does not exist or you do not have permission to access it."
	}

	// Get all files at top level (not gitignored)
	const [allFiles, _] = await listFiles(dirPath, false, 200)

	let result = ""

	// Separate files to parse and remaining files
	const { filesToParse, remainingFiles } = separateFiles(allFiles)

	const languageParsers = await loadRequiredLanguageParsers(filesToParse)

	// Parse specific files we have language parsers for
	// const filesWithoutDefinitions: string[] = []

	// Filter filepaths for access if controller is provided
	const allowedFilesToParse = clineIgnoreController ? clineIgnoreController.filterPaths(filesToParse) : filesToParse

	for (const filePath of allowedFilesToParse) {
		const definitions = await parseFile(filePath, languageParsers, clineIgnoreController)
		if (definitions) {
			result += `${path.relative(dirPath, filePath).toPosix()}\n${definitions}\n`
		}
		// else {
		// 	filesWithoutDefinitions.push(file)
		// }
	}

	// List remaining files' paths
	// let didFindUnparsedFiles = false
	// filesWithoutDefinitions
	// 	.concat(remainingFiles)
	// 	.sort()
	// 	.forEach((file) => {
	// 		if (!didFindUnparsedFiles) {
	// 			result += "# Unparsed Files\n\n"
	// 			didFindUnparsedFiles = true
	// 		}
	// 		result += `${path.relative(dirPath, file)}\n`
	// 	})

	return result ? result : "No source code definitions found."
}

function separateFiles(allFiles: string[]): {
	filesToParse: string[]
	remainingFiles: string[]
} {
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
		// Kotlin
		"kt",
	].map((e) => `.${e}`)
	const filesToParse = allFiles.filter((file) => extensions.includes(path.extname(file))).slice(0, 50) // 50 files max
	const remainingFiles = allFiles.filter((file) => !filesToParse.includes(file))
	return { filesToParse, remainingFiles }
}

/*
Parsing files using tree-sitter

1. Parse the file content into an AST (Abstract Syntax Tree) using the appropriate language grammar (set of rules that define how the components of a language like keywords, expressions, and statements can be combined to create valid programs).
2. Create a query using a language-specific query string, and run it against the AST's root node to capture specific syntax elements.
    - We use tag queries to identify named entities in a program, and then use a syntax capture to label the entity and its name. A notable example of this is GitHub's search-based code navigation.
	- Our custom tag queries are based on tree-sitter's default tag queries, but modified to only capture definitions.
3. Sort the captures by their position in the file, output the name of the definition, and format by i.e. adding "|----\n" for gaps between captured sections.

This approach allows us to focus on the most relevant parts of the code (defined by our language-specific queries) and provides a concise yet informative view of the file's structure and key elements.

- https://github.com/tree-sitter/node-tree-sitter/blob/master/test/query_test.js
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/query-test.js
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/test/helper.js
- https://tree-sitter.github.io/tree-sitter/code-navigation-systems
*/
async function parseFile(
	filePath: string,
	languageParsers: LanguageParser,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string | null> {
	if (clineIgnoreController && !clineIgnoreController.validateAccess(filePath)) {
		return null
	}
	const fileContent = await fs.readFile(filePath, "utf8")
	const ext = path.extname(filePath).toLowerCase().slice(1)

	const { parser, query } = languageParsers[ext] || {}
	if (!parser || !query) {
		return `Unsupported file type: ${filePath}`
	}

	let formattedOutput = ""

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
			const { node, name } = capture
			// Get the start and end lines of the current AST node
			const startLine = node.startPosition.row
			const endLine = node.endPosition.row
			// Once we've retrieved the nodes we care about through the language query, we filter for lines with definition names only.
			// name.startsWith("name.reference.") > refs can be used for ranking purposes, but we don't need them for the output
			// previously we did `name.startsWith("name.definition.")` but this was too strict and excluded some relevant definitions

			// Add separator if there's a gap between captures
			if (lastLine !== -1 && startLine > lastLine + 1) {
				formattedOutput += "|----\n"
			}
			// Only add the first line of the definition
			// query captures includes the definition name and the definition implementation, but we only want the name (I found discrepencies in the naming structure for various languages, i.e. javascript names would be 'name' and typescript names would be 'name.definition)
			if (name.includes("name") && lines[startLine]) {
				formattedOutput += `│${lines[startLine]}\n`
			}
			// Adds all the captured lines
			// for (let i = startLine; i <= endLine; i++) {
			// 	formattedOutput += `│${lines[i]}\n`
			// }
			//}

			lastLine = endLine
		})
	} catch (error) {
		console.log(`Error parsing file: ${error}\n`)
	}

	if (formattedOutput.length > 0) {
		return `|----\n${formattedOutput}|----\n`
	}
	return null
}

/**
 * Parses a source code file to find and extract the full text content of a specific function definition.
 * @param filePath The path to the source code file.
 * @param functionName The name of the function to find.
 * @param languageParsers Preloaded language parsers.
 * @param clineIgnoreController Optional controller for handling ignored files.
 * @returns The full text block containing the function definition, extracted based on sibling nodes, or null/error string.
 */
async function parseFunctionDefinition(
	filePath: string,
	functionName: string,
	languageParsers: LanguageParser,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string | null> {
	if (clineIgnoreController && !clineIgnoreController.validateAccess(filePath)) {
		console.log(`Access denied for file: ${filePath}`)
		return null // Access denied
	}

	let fileContent: string
	try {
		fileContent = await fs.readFile(filePath, "utf8")
	} catch (error) {
		console.error(`Error reading file ${filePath}:`, error)
		return `Error reading file: ${filePath}` // File read error
	}

	const ext = path.extname(filePath).toLowerCase().slice(1)
	const { parser, query } = languageParsers[ext] || {}

	if (!parser || !query) {
		console.log(`Unsupported file type or missing parser/query for: ${filePath}`)
		return `Unsupported file type: ${ext}` // Unsupported type
	}

	try {
		const tree = parser.parse(fileContent)
		const captures = query.captures(tree.rootNode)
		const lines = fileContent.split("\n") // Split content into lines for extraction

		// Find the capture that corresponds to the function definition name
		for (const capture of captures) {
			const { node, name } = capture
			// Check if the capture is a definition name and matches the requested functionName
			if (name.includes("name") && node.text.trim() === functionName) {
				// Traverse upwards from the name node to find a suitable definition node.
				let definitionNode = node
				// Common function/method definition types across languages - adjust as needed
				const definitionTypes = [
					"function_definition",
					"function_declaration",
					"method_definition",
					"arrow_function",
					"function_item", // Rust
					"function_spec", // Go
					// C/C++ uses 'function_definition'
					"method_declaration", // C#, Java
					"method", // Ruby
					// PHP uses 'function_declaration'
					// Swift uses 'function_declaration'
					// Kotlin uses 'function_declaration'
					"lexical_declaration", // For JS/TS const/let func = ...
					"variable_declarator", // Often part of lexical_declaration
					"pair", // For object methods in JS/TS
				]

				// Traverse up until we find a recognized definition type or hit a boundary
				while (definitionNode.parent && !definitionTypes.includes(definitionNode.type)) {
					// Avoid going too high (e.g., module/program level)
					if (
						!definitionNode.parent.parent ||
						definitionNode.parent.type === "program" ||
						definitionNode.parent.type === "module"
					) {
						// If parent is program/module, the current node might be the best we can get
						break
					}
					definitionNode = definitionNode.parent
				}

				// If the found node is just an identifier, try its parent one last time
				if (definitionNode.type.includes("identifier") && definitionNode.parent) {
					definitionNode = definitionNode.parent
				}

				// Ensure we have a valid node to work with
				if (!definitionNode) {
					console.warn(`Could not reliably identify definition node for ${functionName} in ${filePath}.`)
					return node.text // Fallback to the name node's text if traversal fails
				}

				// Found the potential definition node, now find its named siblings
				const prevSibling = definitionNode.previousNamedSibling
				const nextSibling = definitionNode.nextNamedSibling

				// Determine start line: line after previous sibling ends, or 0 if no previous sibling
				const startLine = prevSibling ? prevSibling.endPosition.row + 1 : 0

				// Determine end line: line where next sibling starts, or end of file if no next sibling
				const endLine = nextSibling ? nextSibling.startPosition.row : lines.length

				// Extract the text block between the siblings
				if (startLine < endLine) {
					// Slice lines (exclusive of endLine) and join back with newline
					return lines.slice(startLine, endLine).join("\n")
				} else {
					// Fallback if slicing range is invalid (e.g., siblings overlap or parsing issue)
					console.warn(
						`Invalid slice range [${startLine}, ${endLine}) for ${functionName} in ${filePath}. Falling back to definition node text.`,
					)
					return definitionNode.text
				}
			}
		}

		console.log(`Function "${functionName}" not found in ${filePath}`)
		return null // Function not found
	} catch (error) {
		console.error(`Error parsing file ${filePath} with tree-sitter:`, error)
		return `Error parsing file: ${filePath}` // Parsing error
	}
}

// Exported function to be called by the tool execution logic
export async function parseSourceCodeForFunctionDefinition(
	filePath: string,
	functionName: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string | null> {
	// Basic validation
	if (!filePath || !functionName) {
		return "File path and function name are required."
	}
	const fileExists = await fileExistsAtPath(path.resolve(filePath))
	if (!fileExists) {
		return `File not found: ${filePath}`
	}

	// Determine the language and load the necessary parser
	const ext = path.extname(filePath).toLowerCase().slice(1)
	if (!ext) {
		return "Could not determine file type from extension."
	}
	const languageParsers = await loadRequiredLanguageParsers([filePath])
	if (!languageParsers[ext]) {
		return `Unsupported language or parser not available for: ${ext}`
	}

	// Call the internal parsing function
	return parseFunctionDefinition(filePath, functionName, languageParsers, clineIgnoreController)
}
