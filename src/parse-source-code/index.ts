import * as fs from "fs/promises"
import { globby, Options } from "globby"
import os from "os"
import * as path from "path"
import { LanguageParser, loadRequiredLanguageParsers } from "./languageParser"

export const LIST_FILES_LIMIT = 500

// TODO: implement caching behavior to avoid having to keep analyzing project for new tasks.
export async function parseSourceCodeForDefinitionsTopLevel(dirPath: string): Promise<string> {
	// check if the path exists
	const dirExists = await fs
		.access(path.resolve(dirPath))
		.then(() => true)
		.catch(() => false)
	if (!dirExists) {
		return "This directory does not exist or you do not have permission to access it."
	}

	// Get all files at top level (not gitignored)
	const allFiles = await listFiles(dirPath, false)

	let result = ""

	// Separate files to parse and remaining files
	const { filesToParse, remainingFiles } = separateFiles(allFiles)

	const languageParsers = await loadRequiredLanguageParsers(filesToParse)

	// Parse specific files we have language parsers for
	// const filesWithoutDefinitions: string[] = []
	for (const file of filesToParse) {
		const definitions = await parseFile(file, languageParsers)
		if (definitions) {
			result += `${path.relative(dirPath, file)}\n${definitions}\n`
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

export async function listFiles(dirPath: string, recursive: boolean): Promise<string[]> {
	const absolutePath = path.resolve(dirPath)
	// Do not allow listing files in root or home directory, which Claude tends to want to do when the user's prompt is vague.
	const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
	const isRoot = absolutePath === root
	if (isRoot) {
		return [root]
	}
	const homeDir = os.homedir()
	const isHomeDir = absolutePath === homeDir
	if (isHomeDir) {
		return [homeDir]
	}

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
		markDirectories: true, // Append a / on any directories matched
		gitignore: recursive, // globby ignores any files that are gitignored
		ignore: recursive ? dirsToIgnore : undefined, // just in case there is no gitignore, we ignore sensible defaults
		onlyFiles: false, // true by default, false means it will list directories on their own too
	}
	// * globs all files in one dir, ** globs files in nested directories
	const files = recursive
		? await globbyLevelByLevel(options)
		: (await globby("*", options)).slice(0, LIST_FILES_LIMIT)
	return files
}

// globby doesnt natively support top down level by level globbing, so we implement it ourselves
async function globbyLevelByLevel(options?: Options) {
	let results: string[] = []
	let currentLevel = 0
	while (results.length < LIST_FILES_LIMIT) {
		// Construct the glob pattern for the current level
		const pattern = currentLevel === 0 ? "*" : `${"*/".repeat(currentLevel)}*`

		// Get files and directories at the current level
		const filesAtLevel = await globby(pattern, options)

		// If no more files found at this level, break the loop
		if (filesAtLevel.length === 0) {
			break
		}

		// Add the files found at this level to the result
		results.push(...filesAtLevel)

		// If we have reached the max limit, slice the array to the limit and break
		if (results.length >= LIST_FILES_LIMIT) {
			results = results.slice(0, LIST_FILES_LIMIT)
			break
		}

		// Move to the next level
		currentLevel++
	}

	return results
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
async function parseFile(filePath: string, languageParsers: LanguageParser): Promise<string | undefined> {
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
	return undefined
}
