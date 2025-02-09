import * as fs from "fs/promises"
import * as path from "path"
import { listFiles } from "../glob/list-files"
import { LanguageParser, loadRequiredLanguageParsers, CodeDefinition, FileAnalysis, ImportInfo } from "./languageParser"
import { fileExistsAtPath } from "../../utils/fs"

// Configuration for repository analysis
const CONFIG = {
	DEFAULT_TOKEN_BUDGET: 1024 * 8, // Default token budget (can be adjusted)
	MAX_FILES: 50, // Maximum number of files to analyze
	MIN_FILES: 5, // Minimum number of files to analyze
	SAMPLE_SIZE: 100, // Number of lines to sample for token estimation
}

interface CacheEntry {
	timestamp: number
	definitions: string
	analysis: FileAnalysis // Store the full analysis for relationship tracking
	tokenCount: number // Store token count for budget management
}

const definitionsCache: Map<string, CacheEntry> = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getFileTimestamp(filePath: string): Promise<number> {
	const stats = await fs.stat(filePath)
	return stats.mtimeMs
}

async function getCachedDefinitions(filePath: string): Promise<string | null> {
	const cached = definitionsCache.get(filePath)
	if (!cached) {
		return null
	}

	const currentTimestamp = await getFileTimestamp(filePath)
	if (currentTimestamp > cached.timestamp || Date.now() - cached.timestamp > CACHE_TTL) {
		definitionsCache.delete(filePath)
		return null
	}

	return cached.definitions
}

function estimateTokenCount(content: string): number {
	// Split into potential tokens using common code separators
	const tokens = content.split(/[\s{}()\[\]<>:;,=+\-*/%!&|^~?]/).filter((token) => token.length > 0) // Remove empty tokens

	// Count string literals (both single and double quoted)
	const stringLiterals = (content.match(/(['"])(?:(?!\1).)*\1/g) || []).length

	// Count numbers
	const numbers = (content.match(/\b\d+(?:\.\d+)?\b/g) || []).length

	// Count operators and punctuation
	const operators = (content.match(/[+\-*/%=!<>&|^]+/g) || []).length

	// Sum up all token types
	return tokens.length + stringLiterals + numbers + operators
}

function sampleFileContent(content: string): string {
	const lines = content.split("\n")
	if (lines.length <= CONFIG.SAMPLE_SIZE) {
		return content
	}

	const step = Math.floor(lines.length / CONFIG.SAMPLE_SIZE)
	return lines.filter((_, i) => i % step === 0).join("\n")
}

async function findOptimalFileSet(files: string[], tokenBudget: number): Promise<string[]> {
	// Sort files by importance (currently using file size as a proxy)
	const fileStats = await Promise.all(
		files.map(async (file) => {
			const stats = await fs.stat(file)
			return { file, size: stats.size }
		}),
	)

	// Sort by size descending (assuming larger files are more important)
	fileStats.sort((a, b) => b.size - a.size)

	let totalTokens = 0
	const selectedFiles: string[] = []

	for (const { file } of fileStats) {
		if (selectedFiles.length >= CONFIG.MAX_FILES) break

		const content = await fs.readFile(file, "utf8")
		const sampleContent = sampleFileContent(content)
		const estimatedTokens = estimateTokenCount(sampleContent)

		if (totalTokens + estimatedTokens > tokenBudget && selectedFiles.length >= CONFIG.MIN_FILES) {
			break
		}

		selectedFiles.push(file)
		totalTokens += estimatedTokens
	}

	return selectedFiles
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

function calculateComplexity(def: CodeDefinition, lines: string[]): number {
	const content = lines.slice(def.startLine, def.endLine + 1).join("\n")
	// Simple complexity metrics:
	// 1. Number of lines
	const lineCount = content.split("\n").length
	// 2. Number of branches (if, switch, try)
	const branchCount = (content.match(/(if|switch|try)/g) || []).length
	// 3. Number of loops (for, while)
	const loopCount = (content.match(/(for|while)/g) || []).length

	return lineCount + branchCount * 2 + loopCount * 2
}

function calculateRank(def: CodeDefinition): number {
	// Weight factors for different metrics
	const REFERENCE_WEIGHT = 2
	const IMPORT_WEIGHT = 3
	const COMPLEXITY_WEIGHT = 1

	const referenceScore = def.metrics.referenceCount * REFERENCE_WEIGHT
	const importScore = def.metrics.importCount * IMPORT_WEIGHT
	const complexityScore = Math.log(def.metrics.complexity + 1) * COMPLEXITY_WEIGHT

	return referenceScore + importScore + complexityScore
}

async function parseFile(filePath: string, languageParsers: LanguageParser): Promise<string | undefined> {
	const fileContent = await fs.readFile(filePath, "utf8")
	const ext = path.extname(filePath).toLowerCase().slice(1)
	const lines = fileContent.split("\n")

	const { parser, query, importQuery } = languageParsers[ext] || {}
	if (!parser || !query) {
		return `Unsupported file type: ${filePath}`
	}

	const analysis: FileAnalysis = {
		definitions: [],
		imports: [],
		exportedSymbols: [],
	}

	try {
		const tree = parser.parse(fileContent)
		const captures = query.captures(tree.rootNode)

		// Analyze imports first if we have an import query
		if (importQuery) {
			const importCaptures = importQuery.captures(tree.rootNode)
			let currentImport: Partial<ImportInfo> = { source: filePath }

			importCaptures.forEach((capture) => {
				const { name, node } = capture
				if (name === "module") {
					currentImport.target = node.text.replace(/['"`]/g, "")
				} else if (name === "import") {
					if (currentImport.target) {
						analysis.imports.push({
							source: filePath,
							target: currentImport.target,
							importedSymbols: [node.text],
							isTypeOnly: false,
						})
					}
				}
			})
		}

		// First pass: collect all definitions
		const definitionMap = new Map<string, CodeDefinition>()

		captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

		captures.forEach((capture) => {
			const { node, name } = capture
			if (name.includes("name")) {
				const defName = lines[node.startPosition.row].trim()
				const type = name.includes("class")
					? "class"
					: name.includes("method")
						? "method"
						: name.includes("function")
							? "function"
							: name.includes("interface")
								? "interface"
								: "module"

				const def: CodeDefinition = {
					name: defName,
					type,
					startLine: node.startPosition.row,
					endLine: node.endPosition.row,
					references: [],
					referencedBy: [],
					filePath,
					importedBy: [],
					rank: 0,
					metrics: {
						referenceCount: 0,
						importCount: 0,
						complexity: 0,
					},
				}

				def.metrics.complexity = calculateComplexity(def, lines)
				definitionMap.set(defName, def)
			}
		})

		// Second pass: analyze relationships and calculate ranks
		const definitions = Array.from(definitionMap.values())
		definitions.forEach((def) => {
			// Simple relationship analysis: check if any definition names appear in the content
			const defContent = lines.slice(def.startLine, def.endLine + 1).join("\n")
			definitions.forEach((otherDef) => {
				if (def.name !== otherDef.name && defContent.includes(otherDef.name)) {
					def.references.push(otherDef.name)
					otherDef.referencedBy.push(def.name)
					otherDef.metrics.referenceCount++
				}
			})

			// Calculate rank after all metrics are updated
			def.rank = calculateRank(def)
		})

		// Sort definitions by rank before adding to analysis
		analysis.definitions = definitions.sort((a, b) => b.rank - a.rank)

		// Format output with ranking information
		let formattedOutput = ""
		analysis.definitions.forEach((def) => {
			formattedOutput += `│${def.name} (${def.type}) [rank: ${def.rank.toFixed(1)}]\n`
			if (def.references.length > 0) {
				formattedOutput += `│  References: ${def.references.join(", ")}\n`
			}
			if (def.referencedBy.length > 0) {
				formattedOutput += `│  Referenced by: ${def.referencedBy.join(", ")}\n`
			}
			if (def.metrics.complexity > 1) {
				formattedOutput += `│  Complexity: ${def.metrics.complexity}\n`
			}
			formattedOutput += "│\n"
		})

		if (formattedOutput.length > 0) {
			return `|----\n${formattedOutput}|----\n`
		}
	} catch (error) {
		console.error(`Error parsing file ${filePath}:`, error)
	}

	return undefined
}

// Export these functions for testing
export { parseFile, calculateComplexity, calculateRank }

export async function parseSourceCodeForDefinitionsTopLevel(
	dirPath: string,
	tokenBudget: number = CONFIG.DEFAULT_TOKEN_BUDGET,
): Promise<string> {
	const dirExists = await fileExistsAtPath(path.resolve(dirPath))
	if (!dirExists) {
		return "This directory does not exist or you do not have permission to access it."
	}

	const [allFiles, _] = await listFiles(dirPath, false, 200)
	let result = ""

	const { filesToParse: eligibleFiles, remainingFiles } = separateFiles(allFiles)
	const optimizedFileSet = await findOptimalFileSet(eligibleFiles, tokenBudget)
	const languageParsers = await loadRequiredLanguageParsers(optimizedFileSet)

	for (const file of optimizedFileSet) {
		const cachedDefs = await getCachedDefinitions(file)
		if (cachedDefs) {
			result += `${path.relative(dirPath, file).toPosix()}\n${cachedDefs}\n`
			continue
		}

		const definitions = await parseFile(file, languageParsers)
		if (definitions) {
			definitionsCache.set(file, {
				timestamp: Date.now(),
				definitions,
				analysis: {
					definitions: [],
					imports: [],
					exportedSymbols: [],
				},
				tokenCount: 0,
			})
			result += `${path.relative(dirPath, file).toPosix()}\n${definitions}\n`
		}
	}

	return result || "No source code definitions found."
}
