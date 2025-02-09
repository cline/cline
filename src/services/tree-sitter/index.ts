import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import { listFiles } from "../glob/list-files"
import { LanguageParser, loadRequiredLanguageParsers, CodeDefinition, FileAnalysis, ImportInfo } from "./languageParser"
import { fileExistsAtPath } from "../../utils/fs"
import { ClineIgnoreController } from "../../core/ignore/ClineIgnoreController"

// Configuration for repository analysis
const CONFIG = {
	DEFAULT_TOKEN_BUDGET: 1024 * 8, // Default token budget (can be adjusted)
	MAX_FILES: 50, // Maximum number of files to analyze
	MIN_FILES: 5, // Minimum number of files to analyze
	SAMPLE_SIZE: 100, // Number of lines to sample for token estimation
	CACHE_TTL: 5 * 60 * 1000, // Cache TTL in milliseconds (5 minutes)
	MAX_CACHE_ENTRIES: 1000, // Maximum number of entries in cache
	MIN_CACHE_TTL: 30 * 1000, // Minimum cache TTL (30 seconds)
	MAX_CACHE_TTL: 30 * 60 * 1000, // Maximum cache TTL (30 minutes)
}

const SCORING = {
	// Base weights
	REFERENCE_WEIGHT: 2,
	IMPORT_WEIGHT: 3,
	COMPLEXITY_WEIGHT: 1,
	SIZE_WEIGHT: 1,

	// Conversation context weights
	MENTION_WEIGHT: 4,
	VIEW_WEIGHT: 2.5,
	RECENCY_WEIGHT: 1.5,

	// Time constants
	HOUR_MS: 3600000,

	calculateRecencyScore(timestamp: number): number {
		if (!timestamp) {
			return 0
		}
		const now = Date.now()
		return Math.exp(-Math.max(0, now - timestamp) / this.HOUR_MS)
	},

	calculateContextScore(metrics: { mentions: number; lastMentionedTs: number; views: number; lastViewedTs: number }): number {
		const mentionScore = metrics.mentions * this.MENTION_WEIGHT
		const viewScore = metrics.views * this.VIEW_WEIGHT
		const recencyScore =
			(this.calculateRecencyScore(metrics.lastMentionedTs) + this.calculateRecencyScore(metrics.lastViewedTs)) *
			this.RECENCY_WEIGHT

		return mentionScore + viewScore + recencyScore
	},
}

interface CacheEntry {
	timestamp: number
	definitions: string
	analysis: FileAnalysis // Store the full analysis for relationship tracking
	tokenCount: number // Store token count for budget management
	lastAccessed: number // Track when the entry was last accessed
}

interface CacheConfig {
	ttl: number // Time to live in milliseconds
	maxEntries: number // Maximum number of entries
	watchFiles: boolean // Whether to watch files for changes
}

class DefinitionsCache {
	private cache: Map<string, CacheEntry> = new Map()
	private fileWatchers: Map<string, fsSync.FSWatcher> = new Map()
	private config: CacheConfig

	constructor(config?: Partial<CacheConfig>) {
		this.config = {
			ttl: CONFIG.CACHE_TTL,
			maxEntries: CONFIG.MAX_CACHE_ENTRIES,
			watchFiles: true,
			...config,
		}

		// Validate TTL bounds
		this.config.ttl = Math.max(CONFIG.MIN_CACHE_TTL, Math.min(CONFIG.MAX_CACHE_TTL, this.config.ttl))
	}

	async get(filePath: string): Promise<string | null> {
		const cached = this.cache.get(filePath)
		if (!cached) {
			return null
		}

		const currentTimestamp = await getFileTimestamp(filePath)
		const now = Date.now()

		// Check if cache is valid - invalidate if file is inaccessible or modified
		if (currentTimestamp === null || currentTimestamp > cached.timestamp || now - cached.timestamp > this.config.ttl) {
			this.delete(filePath)
			return null
		}

		// Update last accessed time
		cached.lastAccessed = now
		return cached.definitions
	}

	set(filePath: string, entry: Omit<CacheEntry, "lastAccessed" | "timestamp">): void {
		// Ensure we don't exceed max entries
		if (this.cache.size >= this.config.maxEntries) {
			this.removeOldestEntry()
		}

		const now = Date.now()
		this.cache.set(filePath, {
			...entry,
			timestamp: now,
			lastAccessed: now,
		})

		// Set up file watcher if enabled
		if (this.config.watchFiles) {
			this.watchFile(filePath)
		}
	}

	delete(filePath: string): void {
		this.cache.delete(filePath)
		this.unwatchFile(filePath)
	}

	clear(): void {
		this.cache.clear()
		this.unwatchAllFiles()
	}

	private removeOldestEntry(): void {
		let oldestTime = Date.now()
		let oldestKey: string | null = null

		for (const [key, entry] of this.cache.entries()) {
			if (entry.lastAccessed < oldestTime) {
				oldestTime = entry.lastAccessed
				oldestKey = key
			}
		}

		if (oldestKey) {
			this.delete(oldestKey)
		}
	}

	private watchFile(filePath: string): void {
		// Don't create duplicate watchers
		if (this.fileWatchers.has(filePath)) {
			return
		}

		try {
			const watcher = fsSync.watch(filePath, (eventType) => {
				if (eventType === "change") {
					this.delete(filePath)
				}
			})

			this.fileWatchers.set(filePath, watcher)

			// Handle watcher errors
			watcher.on("error", (error) => {
				console.error(`Error watching file ${filePath}:`, error)
				this.unwatchFile(filePath)
			})
		} catch (error) {
			console.error(`Failed to set up watcher for ${filePath}:`, error)
		}
	}

	private unwatchFile(filePath: string): void {
		const watcher = this.fileWatchers.get(filePath)
		if (watcher) {
			watcher.close()
			this.fileWatchers.delete(filePath)
		}
	}

	private unwatchAllFiles(): void {
		for (const [filePath] of this.fileWatchers) {
			this.unwatchFile(filePath)
		}
	}
}

// Create a singleton instance of the cache
const definitionsCache = new DefinitionsCache()

class ConversationContext {
	private fileMetrics: Map<
		string,
		{
			mentions: number
			lastMentionedTs: number
			views: number
			lastViewedTs: number
		}
	> = new Map()

	recordMention(filePath: string) {
		const now = Date.now()
		const metrics = this.fileMetrics.get(filePath) || {
			mentions: 0,
			lastMentionedTs: 0,
			views: 0,
			lastViewedTs: 0,
		}
		metrics.mentions++
		metrics.lastMentionedTs = now
		this.fileMetrics.set(filePath, metrics)
	}

	recordView(filePath: string) {
		const now = Date.now()
		const metrics = this.fileMetrics.get(filePath) || {
			mentions: 0,
			lastMentionedTs: 0,
			views: 0,
			lastViewedTs: 0,
		}
		metrics.views++
		metrics.lastViewedTs = now
		this.fileMetrics.set(filePath, metrics)
	}

	getMetrics(filePath: string) {
		return (
			this.fileMetrics.get(filePath) || {
				mentions: 0,
				lastMentionedTs: 0,
				views: 0,
				lastViewedTs: 0,
			}
		)
	}

	clear() {
		this.fileMetrics.clear()
	}
}

// Create singleton instance
const conversationContext = new ConversationContext()

// Export for use in other modules
export { conversationContext }

async function getFileTimestamp(filePath: string): Promise<number | null> {
	try {
		const stats = await fs.stat(filePath)
		return stats.mtimeMs
	} catch (error) {
		return null
	}
}

function estimateTokenCount(content: string): number {
	// Split into potential tokens using common code separators
	const tokens = content.split(/[\s{}()\[\]<>:;,=+\-*/%!&|^~?]/).filter((token) => token.length > 0)

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
	// Calculate importance score for each file
	const fileStats = await Promise.all(
		files.map(async (file) => {
			const stats = await fs.stat(file)
			const contextMetrics = conversationContext.getMetrics(file)

			// Normalize file size (log scale to prevent large files from dominating)
			const normalizedSize = Math.log(stats.size + 1) / Math.log(1024 * 1024) // Normalize to MB scale
			const sizeScore = normalizedSize * SCORING.SIZE_WEIGHT

			// Get context score using shared scoring
			const contextScore = SCORING.calculateContextScore(contextMetrics)

			return {
				file,
				size: stats.size,
				importanceScore: sizeScore + contextScore,
			}
		}),
	)

	// Sort by importance score descending
	fileStats.sort((a, b) => b.importanceScore - a.importanceScore)

	let totalTokens = 0
	const selectedFiles: string[] = []

	for (const { file } of fileStats) {
		if (selectedFiles.length >= CONFIG.MAX_FILES) {
			break
		}

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
	// Base scores
	const referenceScore = def.metrics.referenceCount * SCORING.REFERENCE_WEIGHT
	const importScore = def.metrics.importCount * SCORING.IMPORT_WEIGHT
	const complexityScore = Math.log(def.metrics.complexity + 1) * SCORING.COMPLEXITY_WEIGHT

	// Context scores using shared scoring
	const contextScore = SCORING.calculateContextScore({
		mentions: def.metrics.conversationMentions,
		lastMentionedTs: def.metrics.lastMentionedTs,
		views: def.metrics.recentViewCount,
		lastViewedTs: def.metrics.lastViewedTs,
	})

	return referenceScore + importScore + complexityScore + contextScore
}

async function parseFile(
	filePath: string,
	languageParsers: LanguageParser,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string | null> {
	if (clineIgnoreController && !clineIgnoreController.validateAccess(filePath)) {
		return null
	}

	// Record file view when parsing
	conversationContext.recordView(filePath)

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

	let formattedOutput = ""

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

				// Get conversation metrics for the file
				const contextMetrics = conversationContext.getMetrics(filePath)

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
						conversationMentions: contextMetrics.mentions,
						lastMentionedTs: contextMetrics.lastMentionedTs,
						recentViewCount: contextMetrics.views,
						lastViewedTs: contextMetrics.lastViewedTs,
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

	return null
}

// Export these functions for testing
export { parseFile, calculateComplexity, calculateRank }

export async function parseSourceCodeForDefinitionsTopLevel(
	dirPath: string,
	clineIgnoreController?: ClineIgnoreController,
	tokenBudget: number = CONFIG.DEFAULT_TOKEN_BUDGET,
): Promise<string> {
	const dirExists = await fileExistsAtPath(path.resolve(dirPath))
	if (!dirExists) {
		return "This directory does not exist or you do not have permission to access it."
	}

	const [allFiles, _] = await listFiles(dirPath, false, 200)
	let result = ""

	const { filesToParse: eligibleFiles } = separateFiles(allFiles)
	const optimizedFileSet = await findOptimalFileSet(eligibleFiles, tokenBudget)
	const languageParsers = await loadRequiredLanguageParsers(optimizedFileSet)

	// Filter filepaths for access if controller is provided
	const allowedFiles = clineIgnoreController ? clineIgnoreController.filterPaths(optimizedFileSet) : optimizedFileSet

	for (const file of allowedFiles) {
		const cachedDefs = await definitionsCache.get(file)
		if (cachedDefs) {
			result += `${path.relative(dirPath, file).toPosix()}\n${cachedDefs}\n`
			continue
		}

		const definitions = await parseFile(file, languageParsers, clineIgnoreController)
		if (definitions) {
			definitionsCache.set(file, {
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
