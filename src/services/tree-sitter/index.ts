import * as fs from "fs/promises"
import * as path from "path"
import { listFiles } from "../glob/list-files"
import { LanguageParser, loadRequiredLanguageParsers } from "./languageParser"
import { fileExistsAtPath } from "../../utils/fs"
import { parseMarkdown, formatMarkdownCaptures } from "./markdownParser"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"

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
	"kts",
	// Markdown
	"md",
	"markdown",
	// JSON
	"json",
].map((e) => `.${e}`)

export async function parseSourceCodeDefinitionsForFile(
	filePath: string,
	rooIgnoreController?: RooIgnoreController,
): Promise<string | undefined> {
	// check if the file exists
	const fileExists = await fileExistsAtPath(path.resolve(filePath))
	if (!fileExists) {
		return "This file does not exist or you do not have permission to access it."
	}

	// Get file extension to determine parser
	const ext = path.extname(filePath).toLowerCase()
	// Check if the file extension is supported
	if (!extensions.includes(ext)) {
		return undefined
	}

	// Special case for markdown files
	if (ext === ".md" || ext === ".markdown") {
		// Check if we have permission to access this file
		if (rooIgnoreController && !rooIgnoreController.validateAccess(filePath)) {
			return undefined
		}

		// Read file content
		const fileContent = await fs.readFile(filePath, "utf8")

		// Split the file content into individual lines
		const lines = fileContent.split("\n")

		// Parse markdown content to get captures
		const markdownCaptures = parseMarkdown(fileContent)

		// Process the captures
		const markdownDefinitions = processCaptures(markdownCaptures, lines, 4)

		if (markdownDefinitions) {
			return `# ${path.basename(filePath)}\n${markdownDefinitions}`
		}
		return undefined
	}

	// For other file types, load parser and use tree-sitter
	const languageParsers = await loadRequiredLanguageParsers([filePath])

	// Parse the file if we have a parser for it
	const definitions = await parseFile(filePath, languageParsers, rooIgnoreController)
	if (definitions) {
		return `# ${path.basename(filePath)}\n${definitions}`
	}

	return undefined
}

// TODO: implement caching behavior to avoid having to keep analyzing project for new tasks.
export async function parseSourceCodeForDefinitionsTopLevel(
	dirPath: string,
	rooIgnoreController?: RooIgnoreController,
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

	// Filter filepaths for access if controller is provided
	const allowedFilesToParse = rooIgnoreController ? rooIgnoreController.filterPaths(filesToParse) : filesToParse

	// Separate markdown files from other files
	const markdownFiles: string[] = []
	const otherFiles: string[] = []

	for (const file of allowedFilesToParse) {
		const ext = path.extname(file).toLowerCase()
		if (ext === ".md" || ext === ".markdown") {
			markdownFiles.push(file)
		} else {
			otherFiles.push(file)
		}
	}

	// Load language parsers only for non-markdown files
	const languageParsers = await loadRequiredLanguageParsers(otherFiles)

	// Process markdown files
	for (const file of markdownFiles) {
		// Check if we have permission to access this file
		if (rooIgnoreController && !rooIgnoreController.validateAccess(file)) {
			continue
		}

		try {
			// Read file content
			const fileContent = await fs.readFile(file, "utf8")

			// Split the file content into individual lines
			const lines = fileContent.split("\n")

			// Parse markdown content to get captures
			const markdownCaptures = parseMarkdown(fileContent)

			// Process the captures
			const markdownDefinitions = processCaptures(markdownCaptures, lines, 4)

			if (markdownDefinitions) {
				result += `# ${path.relative(dirPath, file).toPosix()}\n${markdownDefinitions}\n`
			}
		} catch (error) {
			console.log(`Error parsing markdown file: ${error}\n`)
		}
	}

	// Process other files using tree-sitter
	for (const file of otherFiles) {
		const definitions = await parseFile(file, languageParsers, rooIgnoreController)
		if (definitions) {
			result += `# ${path.relative(dirPath, file).toPosix()}\n${definitions}\n`
		}
	}

	return result ? result : "No source code definitions found."
}

function separateFiles(allFiles: string[]): { filesToParse: string[]; remainingFiles: string[] } {
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
/**
 * Parse a file and extract code definitions using tree-sitter
 *
 * @param filePath - Path to the file to parse
 * @param languageParsers - Map of language parsers
 * @param rooIgnoreController - Optional controller to check file access permissions
 * @returns A formatted string with code definitions or null if no definitions found
 */

/**
 * Process captures from tree-sitter or markdown parser
 *
 * @param captures - The captures to process
 * @param lines - The lines of the file
 * @param minComponentLines - Minimum number of lines for a component to be included
 * @returns A formatted string with definitions
 */
function processCaptures(captures: any[], lines: string[], minComponentLines: number = 4): string | null {
	// Filter function to exclude HTML elements
	const isNotHtmlElement = (line: string): boolean => {
		// Common HTML elements pattern
		const HTML_ELEMENTS = /^[^A-Z]*<\/?(?:div|span|button|input|h[1-6]|p|a|img|ul|li|form)\b/
		const trimmedLine = line.trim()
		return !HTML_ELEMENTS.test(trimmedLine)
	}

	// No definitions found
	if (captures.length === 0) {
		return null
	}

	let formattedOutput = ""

	// Sort captures by their start position
	captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

	// Keep track of the last line we've processed
	let lastLine = -1

	// Track already processed lines to avoid duplicates
	const processedLines = new Set<string>()

	// First pass - categorize captures by type
	captures.forEach((capture) => {
		const { node, name } = capture

		// Skip captures that don't represent definitions
		if (!name.includes("definition") && !name.includes("name")) {
			return
		}

		// Get the parent node that contains the full definition
		const definitionNode = name.includes("name") ? node.parent : node
		if (!definitionNode) return

		// Get the start and end lines of the full definition
		const startLine = definitionNode.startPosition.row
		const endLine = definitionNode.endPosition.row
		const lineCount = endLine - startLine + 1

		// Skip components that don't span enough lines
		if (lineCount < minComponentLines) {
			return
		}

		// Create unique key for this definition based on line range
		// This ensures we don't output the same line range multiple times
		const lineKey = `${startLine}-${endLine}`

		// Skip already processed lines
		if (processedLines.has(lineKey)) {
			return
		}

		// Check if this is a valid component definition (not an HTML element)
		const startLineContent = lines[startLine].trim()

		// Special handling for component name definitions
		if (name.includes("name.definition")) {
			// Extract component name
			const componentName = node.text

			// Add component name to output regardless of HTML filtering
			if (!processedLines.has(lineKey) && componentName) {
				formattedOutput += `${startLine + 1}--${endLine + 1} | ${lines[startLine]}\n`
				processedLines.add(lineKey)
			}
		}
		// For other component definitions
		else if (isNotHtmlElement(startLineContent)) {
			formattedOutput += `${startLine + 1}--${endLine + 1} | ${lines[startLine]}\n`
			processedLines.add(lineKey)

			// If this is part of a larger definition, include its non-HTML context
			if (node.parent && node.parent.lastChild) {
				const contextEnd = node.parent.lastChild.endPosition.row
				const contextSpan = contextEnd - node.parent.startPosition.row + 1

				// Only include context if it spans multiple lines
				if (contextSpan >= minComponentLines) {
					// Add the full range first
					const rangeKey = `${node.parent.startPosition.row}-${contextEnd}`
					if (!processedLines.has(rangeKey)) {
						formattedOutput += `${node.parent.startPosition.row + 1}--${contextEnd + 1} | ${lines[node.parent.startPosition.row]}\n`
						processedLines.add(rangeKey)
					}
				}
			}
		}

		lastLine = endLine
	})

	if (formattedOutput.length > 0) {
		return formattedOutput
	}
	return null
}

/**
 * Parse a file and extract code definitions using tree-sitter
 *
 * @param filePath - Path to the file to parse
 * @param languageParsers - Map of language parsers
 * @param rooIgnoreController - Optional controller to check file access permissions
 * @returns A formatted string with code definitions or null if no definitions found
 */
async function parseFile(
	filePath: string,
	languageParsers: LanguageParser,
	rooIgnoreController?: RooIgnoreController,
): Promise<string | null> {
	// Minimum number of lines for a component to be included
	const MIN_COMPONENT_LINES = 4

	// Check if we have permission to access this file
	if (rooIgnoreController && !rooIgnoreController.validateAccess(filePath)) {
		return null
	}

	// Read file content
	const fileContent = await fs.readFile(filePath, "utf8")
	const ext = path.extname(filePath).toLowerCase().slice(1)

	// Check if we have a parser for this file type
	const { parser, query } = languageParsers[ext] || {}
	if (!parser || !query) {
		return `Unsupported file type: ${filePath}`
	}

	try {
		// Parse the file content into an Abstract Syntax Tree (AST)
		const tree = parser.parse(fileContent)

		// Apply the query to the AST and get the captures
		const captures = query.captures(tree.rootNode)

		// Split the file content into individual lines
		const lines = fileContent.split("\n")

		// Process the captures
		return processCaptures(captures, lines, MIN_COMPONENT_LINES)
	} catch (error) {
		console.log(`Error parsing file: ${error}\n`)
		// Return null on parsing error to avoid showing error messages in the output
		return null
	}
}
