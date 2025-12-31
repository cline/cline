import { extractFileContent } from "@integrations/misc/extract-file-content"
import { regexSearchFiles } from "@services/ripgrep"
import { resolveWorkspacePath } from "@/core/workspace/WorkspaceResolver"
import { ToolResponse } from "../task"
import type { TaskConfig } from "../task/tools/types/TaskConfig"
import { type AgentActions, AgentIterationUpdate, ClineAgent } from "./ClineAgent"

interface SearchResult {
	workspaceName?: string
	workspaceResults: string
	resultCount: number
	success: boolean
}

interface SearchContext {
	filePaths: Set<string>
	searchResults: Map<string, SearchResult>
	fileContents: Map<string, string>
}

interface FileReadResult {
	filePath: string
	content: string
	success: boolean
}

export const ACTIONS_TAGS = {
	ANSWER: `next_step`,
	CONTEXT: `context_list`,
}

function extractTagContent(response: string, tag: string): string[] {
	const tagLength = tag.length
	return response.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "g"))?.map((m) => m.slice(tagLength + 2, -(tagLength + 3))) || []
}

const SEARCH_MODELS = {
	grok: "x-ai/grok-code-fast-1",
	gemini: "google/gemini-3-flash-preview",
}

/**
 * SearchAgent extends ClineAgent to provide natural language search functionality
 * across codebases using an agentic loop.
 */
export class SearchAgent extends ClineAgent<SearchContext> {
	constructor(
		private taskConfig: TaskConfig,
		maxIterations: number = 3,
		onIterationUpdate: (update: AgentIterationUpdate) => void | Promise<void>,
		systemPrompt?: string,
		modelId: string = SEARCH_MODELS.gemini,
	) {
		super({ modelId, maxIterations, onIterationUpdate, systemPrompt })
	}

	buildSystemPrompt(userInput: string, contextPrompt: string): string {
		return buildSearchAgentSystemPrompt(userInput, contextPrompt, ACTIONS_TAGS)
	}

	buildContextPrompt(context: SearchContext, iteration: number): string {
		if (iteration === 0 || (context.searchResults.size === 0 && context.fileContents.size === 0)) {
			return "No context retrieved yet."
		}

		// Build a comprehensive context summary with search results and file contents
		const contextParts: string[] = []
		const MAX_RESULTS_TO_SHOW = 5 // Show details for first 5 searches

		// Track all queries that have been searched
		const allSearchedQueries: string[] = []
		const successfulQueries: string[] = []
		const unsuccessfulQueries: string[] = []

		// Add search results
		let resultIndex = 0
		for (const [query, result] of context.searchResults) {
			allSearchedQueries.push(query)

			if (result.success && result.resultCount > 0) {
				successfulQueries.push(query)
				if (resultIndex < MAX_RESULTS_TO_SHOW) {
					// Include the full search results for the first few queries
					contextParts.push(`### Search: "${query}"\n${result.workspaceResults}`)
				} else {
					// For remaining queries, just show summary
					contextParts.push(
						`### Search: "${query}"\nFound ${result.resultCount} result${result.resultCount > 1 ? "s" : ""}`,
					)
				}
				resultIndex++
			} else {
				unsuccessfulQueries.push(query)
			}
		}

		// Add file contents
		for (const [filePath, content] of context.fileContents) {
			contextParts.push(`### File: ${filePath}\n\`\`\`\n${content}\n\`\`\``)
		}

		// Build header with search history
		const totalFiles = context.filePaths.size
		const totalFileContents = context.fileContents.size
		let header = `Retrieved context from ${context.searchResults.size} search${context.searchResults.size > 1 ? "es" : ""} (${totalFiles} unique file${totalFiles > 1 ? "s" : ""}) and ${totalFileContents} file content${totalFileContents > 1 ? "s" : ""}:\n\n`

		// Add list of previously searched queries to prevent duplicates
		if (allSearchedQueries.length > 0) {
			header += `**Previously searched queries (DO NOT search these again):**\n`
			for (const query of successfulQueries) {
				header += `- "${query}" ✓ (found results)\n`
			}
			for (const query of unsuccessfulQueries) {
				header += `- "${query}" ✗ (no results)\n`
			}
			header += `\n`
		}

		return header + contextParts.join("\n\n")
	}

	extractActions(response: string): AgentActions {
		// Extract context files first (these are the files the agent wants to use in the final answer)
		const contextFilePaths = extractTagContent(response, ACTIONS_TAGS.CONTEXT)

		// Check if ready to answer
		const isReadyToAnswer = response.includes(`<${ACTIONS_TAGS.ANSWER}>`)

		// Extract search queries and file paths from the response
		const searchQueries = this.extractSearchQueries(response)
		const filePathsToRead = this.extractFilePaths(response)

		// Combine search queries and file paths as tool calls
		const toolCalls: Array<{ type: "search" | "file"; value: string }> = []
		for (const query of searchQueries) {
			toolCalls.push({ type: "search", value: query })
		}
		for (const filePath of filePathsToRead) {
			toolCalls.push({ type: "file", value: filePath })
		}

		return {
			toolCalls,
			contextFiles: contextFilePaths,
			isReadyToAnswer,
		}
	}

	private extractSearchQueries(response: string): string[] {
		const searchQueries: string[] = []
		const toolSearchPattern = /<TOOLSEARCH>(.*?)<\/TOOLSEARCH>/gs
		let toolSearchMatch: RegExpExecArray | null = null

		while ((toolSearchMatch = toolSearchPattern.exec(response)) !== null) {
			const toolSearchContent = toolSearchMatch[1]
			const queryMatch = toolSearchContent.match(/<query>(.*?)<\/query>/s)
			if (queryMatch) {
				searchQueries.push(queryMatch[1].trim())
			}
		}

		return searchQueries
	}

	private extractFilePaths(response: string): string[] {
		const filePaths: string[] = []
		const toolFilePattern = /<TOOLFILE>(.*?)<\/TOOLFILE>/gs
		let toolFileMatch: RegExpExecArray | null = null

		while ((toolFileMatch = toolFilePattern.exec(response)) !== null) {
			const toolFileContent = toolFileMatch[1]
			const namePattern = /<name>(.*?)<\/name>/gs
			let nameMatch: RegExpExecArray | null = null

			while ((nameMatch = namePattern.exec(toolFileContent)) !== null) {
				const filePath = nameMatch[1].trim()
				if (filePath) {
					filePaths.push(filePath)
				}
			}
		}

		console.log(`Extracted ${filePaths.length} file paths from response.`)

		return filePaths
	}

	async executeTools(toolCalls: unknown[]): Promise<unknown[]> {
		const searchQueries: string[] = []
		const filePaths: string[] = []

		// Separate search queries from file paths
		for (const toolCall of toolCalls) {
			if (typeof toolCall === "object" && toolCall !== null) {
				const call = toolCall as { type: "search" | "file"; value: string }
				if (call.type === "search") {
					searchQueries.push(call.value)
				} else if (call.type === "file") {
					filePaths.push(call.value)
				}
			}
		}

		const searchStartTime = performance.now()

		// Execute searches and file reads in parallel
		const [searchResults, fileResults] = await Promise.all([
			searchQueries.length > 0 ? this.executeParallelSearches(searchQueries) : Promise.resolve([]),
			filePaths.length > 0 ? this.executeParallelFileReads(filePaths) : Promise.resolve([]),
		])

		// Combine results maintaining order
		const results: unknown[] = []
		let searchIndex = 0
		let fileIndex = 0

		for (const toolCall of toolCalls) {
			if (typeof toolCall === "object" && toolCall !== null) {
				const call = toolCall as { type: "search" | "file"; value: string }
				if (call.type === "search") {
					results.push(searchResults[searchIndex++])
				} else if (call.type === "file") {
					results.push(fileResults[fileIndex++])
				}
			}
		}

		const searchEndTime = performance.now()
		const msg = `Searches executed in ${searchEndTime - searchStartTime} ms. with ${searchQueries.length} queries and ${filePaths.length} file reads. Total results: ${results.length}`
		this.onIterationUpdate({ iteration: this.currentIteration, maxIterations: this.maxIterations, message: msg })

		return results
	}

	private async executeParallelSearches(queries: string[]): Promise<SearchResult[]> {
		const searchPromises = queries.map(async (query) => {
			try {
				const searchPath = this.taskConfig.cwd
				return await this.executeSearch(searchPath, query)
			} catch (error) {
				console.error(`Search failed for query "${query}":`, error)
				return {
					workspaceName: undefined,
					workspaceResults: "",
					resultCount: 0,
					success: false,
				}
			}
		})

		return await Promise.all(searchPromises)
	}

	private async executeSearch(absolutePath: string, regex: string): Promise<SearchResult> {
		try {
			const workspaceResults = await regexSearchFiles(
				this.taskConfig.cwd,
				absolutePath,
				regex,
				undefined,
				this.taskConfig.services.clineIgnoreController,
				false, // exclude hidden files
			)

			const firstLine = workspaceResults.split("\n")[0]
			// Match either "Found X result(s)" or "Showing first X of X+ results"
			const resultMatch = firstLine.match(/Found (\d+) result|Showing first (\d+) of/)
			const resultCount = resultMatch ? parseInt(resultMatch[1] || resultMatch[2], 10) : 0

			return {
				workspaceName: undefined,
				workspaceResults,
				resultCount,
				success: true,
			}
		} catch (error) {
			console.error(`Search failed in ${absolutePath}:`, error)
			return {
				workspaceName: undefined,
				workspaceResults: "",
				resultCount: 0,
				success: false,
			}
		}
	}

	async readContextFiles(filePaths: string[]): Promise<Map<string, string>> {
		const fileResults = await this.executeParallelFileReads(filePaths)
		const fileContents = new Map<string, string>()

		for (const fileResult of fileResults) {
			if (fileResult.success) {
				fileContents.set(fileResult.filePath, fileResult.content)
			}
		}

		return fileContents
	}

	private async executeParallelFileReads(filePaths: string[]): Promise<FileReadResult[]> {
		const fileReadPromises = filePaths.map(async (filePath) => {
			try {
				// Resolve the file path relative to the workspace
				const pathResult = resolveWorkspacePath(this.taskConfig, filePath, "SearchAgent.executeParallelFileReads")
				const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath

				// Read the file content
				const supportsImages = this.taskConfig.api.getModel().info.supportsImages ?? false
				const fileContent = await extractFileContent(absolutePath, supportsImages)

				return {
					filePath,
					content: fileContent.text,
					success: true,
				}
			} catch (error) {
				console.error(`File read failed for "${filePath}":`, error)
				return {
					filePath,
					content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
					success: false,
				}
			}
		})

		return await Promise.all(fileReadPromises)
	}

	public updateContextWithToolResults(context: SearchContext, toolCalls: unknown[], toolResults: unknown[]): boolean {
		let foundNewContext = false

		for (let i = 0; i < toolCalls.length; i++) {
			const toolCall = toolCalls[i]
			const toolResult = toolResults[i]

			if (typeof toolCall === "object" && toolCall !== null) {
				const call = toolCall as { type: "search" | "file"; value: string }

				if (call.type === "search" && toolResult) {
					const result = toolResult as SearchResult
					if (result.success && result.resultCount > 0) {
						// Extract file paths from this result
						const filePaths = this.extractFilePathsFromResult(result)
						const initialSize = context.filePaths.size

						filePaths.forEach((fp) => context.filePaths.add(fp))

						// Check if we found new files
						if (context.filePaths.size > initialSize) {
							foundNewContext = true
						}

						context.searchResults.set(call.value, result)
					}
				} else if (call.type === "file" && toolResult) {
					const fileResult = toolResult as FileReadResult
					if (fileResult.success) {
						// Only add if we haven't read this file before
						if (!context.fileContents.has(fileResult.filePath)) {
							context.fileContents.set(fileResult.filePath, fileResult.content)
							foundNewContext = true
						}
					}
				}
			}
		}

		return foundNewContext
	}

	public updateContextWithFiles(context: SearchContext, fileContents: Map<string, string>): void {
		for (const [filePath, content] of fileContents) {
			if (!context.fileContents.has(filePath)) {
				context.fileContents.set(filePath, content)
			}
		}
	}

	public shouldContinue(_context: SearchContext, foundNewContext: boolean, isReadyToAnswer: boolean): boolean {
		// Stop if ready to answer
		if (isReadyToAnswer) {
			return false
		}

		// Stop if no new context was found
		if (!foundNewContext) {
			return false
		}

		// Continue if we have iterations left
		return this.currentIteration < this.maxIterations - 1
	}

	public formatResult(context: SearchContext, pathOnly = true): ToolResponse {
		// If we have file contents, return those (these are the context files the agent selected)
		if (context.fileContents.size > 0) {
			if (pathOnly) {
				const filePathsArray = Array.from(context.fileContents.keys())
				const resultLabel = filePathsArray.length === 1 ? "1 file" : `${filePathsArray.length} files`
				const formattedPaths = filePathsArray.map((filePath, _i) => `- ${filePath}`).join("\n")

				return `Search Agent returned ${resultLabel}:\n${formattedPaths}`
			}

			return [...context.fileContents].map(([filePath, content]) => ({ type: "text", text: `${filePath}\n${content}` }))
		}

		// Otherwise, return the search results
		if (context.filePaths.size === 0) {
			return "No results found after searching."
		}

		const filePathsArray = Array.from(context.filePaths)
		const resultLabel = filePathsArray.length === 1 ? "1 file" : `${filePathsArray.length} files`
		const formattedPaths = filePathsArray.map((filePath, _i) => `- ${filePath}`).join("\n")

		return `Found ${resultLabel} across multiple searches:\n${formattedPaths}`
	}

	public createInitialContext(): SearchContext {
		return {
			filePaths: new Set<string>(),
			searchResults: new Map<string, SearchResult>(),
			fileContents: new Map<string, string>(),
		}
	}

	private extractFilePathsFromResult(result: SearchResult): string[] {
		const filePaths: string[] = []
		const lines = result.workspaceResults.split("\n")

		for (const line of lines) {
			// File paths don't start with │ and are not empty or header lines
			if (line && !line.startsWith("│") && !line.startsWith("Found ") && !line.startsWith("Showing ")) {
				const trimmed = line.trim()
				if (trimmed) {
					filePaths.push(trimmed)
				}
			}
		}

		return filePaths
	}
}

// ============================================================================
// Helper Functions for System Prompt and Tools Configuration
// ============================================================================

/**
 * Tool definition for SearchAgent.
 * To add a new tool, simply add a new entry to SEARCH_AGENT_TOOLS array below.
 */
interface ToolDefinition {
	tag: string
	subTag: string
	instruction: string
	placeholder: string
	examples?: string[]
}

/**
 * Tools configuration for SearchAgent.
 * Add new tools here by extending this array with a new ToolDefinition.
 */
const SEARCH_AGENT_TOOLS: ToolDefinition[] = [
	{
		tag: "TOOLFILE",
		subTag: "name",
		instruction:
			"To retrieve full content of a codebase file using absolute path filename-DO NOT retrieve files that may contain secrets",
		placeholder: "ABSOLUTE_PATH",
		examples: [
			`See the content of different files: \`<TOOLFILE><name>path/foo.ts</name><name>path/bar.ts</name></TOOLFILE>\``,
		],
	},
	{
		tag: "TOOLSEARCH",
		subTag: "query",
		instruction:
			"Perform regex pattern searches across the codebase. Supports multiple parallel searches by including multiple query tags. All searches will execute simultaneously for faster results",
		placeholder: "SEARCH_QUERY",
		examples: [
			`Single search: \`<TOOLSEARCH><query>symbol name</query></TOOLSEARCH>\``,
			`Single search with REGEX query: \`<TOOLSEARCH><query>class \w+Handler.*ApiHandler|export.*ApiHandler|ApiProvider|ModelProvider</query></TOOLSEARCH>\``,
			`Multiple parallel searches: \`<TOOLSEARCH><query>getController</query></TOOLSEARCH><TOOLSEARCH><query>AuthService</query></TOOLSEARCH>\``,
			`Search for a class definition: \`<TOOLSEARCH><query>class UserController</query></TOOLSEARCH>\``,
		],
	},
]

/**
 * Builds the tools placeholder string for the system prompt.
 * Formats all tool definitions into a readable instruction format.
 */
function buildToolsPlaceholder(): string {
	const toolsPrompts: string[] = []

	for (const tool of SEARCH_AGENT_TOOLS) {
		const prompt = `\`<${tool.tag}><${tool.subTag}>${tool.placeholder}</${tool.subTag}></${tool.tag}>\`: ${tool.instruction}.`

		if (tool.examples && tool.examples.length > 0) {
			toolsPrompts.push(`${prompt}\n\t- ${tool.examples.join("\n\t- ")}`)
		} else {
			toolsPrompts.push(prompt)
		}
	}

	return toolsPrompts.join("\n")
}

/**
 * Builds the complete system prompt for SearchAgent.
 * Replaces all template placeholders with actual values.
 */
function buildSearchAgentSystemPrompt(userInput: string, contextPrompt: string, actionsTags: typeof ACTIONS_TAGS): string {
	const toolsPlaceholder = buildToolsPlaceholder()

	return `You are a context review agent. Evaluate the shared context and determine if you can answer the user's request.

## CURRENT CONTEXT
${contextPrompt}

## TOOLS
Available tools to fetch additional context:
- ${toolsPlaceholder}

## RESPONSE FORMAT
Your response must contain ONLY tags (no explanations, no markdown blocks). Choose one:

**If you have enough context:**
- List relevant files/contexts with <${actionsTags.CONTEXT}> tags (only from CURRENT CONTEXT above)
- End with <${actionsTags.ANSWER}>
- Example: <${actionsTags.CONTEXT}>file1.ts</${actionsTags.CONTEXT}><${actionsTags.CONTEXT}>file2.ts</${actionsTags.CONTEXT}><${actionsTags.ANSWER}>

**If you need NO context:**
- Respond with: <${actionsTags.ANSWER}>

**If you need more context:**
- Use <TOOL*> tags to request it
- Example: <TOOLFILE><name>path/to/file.ts</name></TOOLFILE><TOOLSEARCH><query>class Controller</query></TOOLSEARCH>

## RULES
- Only include files/contexts from CURRENT CONTEXT in <${actionsTags.CONTEXT}> tags
- Never include empty <${actionsTags.CONTEXT}></${actionsTags.CONTEXT}> tags
- Check CURRENT CONTEXT before requesting - avoid duplicate searches
- Use multiple <TOOL*> tags in parallel if needed
- Response must be ONLY tags, nothing else

## INVALID OUTPUT (DO NOT DO THIS)
- Empty context: <${actionsTags.CONTEXT}></${actionsTags.CONTEXT}>
- Explanations: <${actionsTags.ANSWER}> your explanation here
- Non-shared context: <${actionsTags.CONTEXT}>not-in-context.ts</${actionsTags.CONTEXT}>

<user_input>
${userInput}
</user_input>

Remember: Your response will be parsed by a bot. Only include the expected tags.`
}
