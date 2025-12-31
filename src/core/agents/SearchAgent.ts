import { ToolResponse } from "../task"
import type { TaskConfig } from "../task/tools/types/TaskConfig"
import { type AgentActions, AgentContext, AgentIterationUpdate, ClineAgent, FileReadResult, SearchResult } from "./ClineAgent"
import { buildToolsPlaceholder, extractTagContent, SEARCH_AGENT_TOOLS } from "./SubAgentTools"

export const ACTIONS_TAGS = {
	ANSWER: `next_step`,
	CONTEXT: `context_list`,
}

const SEARCH_MODELS = {
	grok: "x-ai/grok-code-fast-1",
	gemini: "google/gemini-3-flash-preview",
}

/**
 * SearchAgent extends ClineAgent to provide natural language search functionality
 * across codebases using an agentic loop.
 */
export class SearchAgent extends ClineAgent {
	constructor(
		taskConfig: TaskConfig,
		maxIterations: number = 3,
		onIterationUpdate: (update: AgentIterationUpdate) => void | Promise<void>,
		systemPrompt?: string,
		modelId: string = SEARCH_MODELS.gemini,
	) {
		super({ modelId, maxIterations, onIterationUpdate, systemPrompt })
		this.setTaskConfig(taskConfig)
		this.registerTools(SEARCH_AGENT_TOOLS)
	}

	buildSystemPrompt(userInput: string, contextPrompt: string): string {
		return buildSearchAgentSystemPrompt(userInput, contextPrompt, ACTIONS_TAGS)
	}

	buildContextPrompt(context: AgentContext, iteration: number): string {
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

		// Use the shared method to extract tool calls
		const toolCallsMap = this.extractToolCalls(response)

		// Combine all tool calls into a unified format
		const toolCalls: Array<{ type: "search" | "file"; value: string }> = []

		const searchQueries = toolCallsMap.get("TOOLSEARCH") ?? []
		for (const query of searchQueries) {
			toolCalls.push({ type: "search", value: query })
		}

		const filePaths = toolCallsMap.get("TOOLFILE") ?? []
		for (const filePath of filePaths) {
			toolCalls.push({ type: "file", value: filePath })
		}

		return {
			toolCalls,
			contextFiles: contextFilePaths,
			isReadyToAnswer,
		}
	}

	async executeTools(toolCalls: unknown[]): Promise<unknown[]> {
		// Group tool calls by type
		const toolsByType = new Map<string, string[]>()
		for (const toolCall of toolCalls) {
			if (typeof toolCall === "object" && toolCall !== null) {
				const call = toolCall as { type: "search" | "file"; value: string }
				const toolTag = call.type === "search" ? "TOOLSEARCH" : "TOOLFILE"
				if (!toolsByType.has(toolTag)) {
					toolsByType.set(toolTag, [])
				}
				toolsByType.get(toolTag)!.push(call.value)
			}
		}

		// Use the shared execution method
		const resultsByTag = await this.executeToolsByTag(toolsByType)

		// Reconstruct results in original order (maintain compatibility with existing code)
		const results: unknown[] = []
		const indexByType = new Map<string, number>()
		for (const toolCall of toolCalls) {
			if (typeof toolCall === "object" && toolCall !== null) {
				const call = toolCall as { type: "search" | "file"; value: string }
				const toolTag = call.type === "search" ? "TOOLSEARCH" : "TOOLFILE"
				const currentIndex = indexByType.get(toolTag) ?? 0
				const toolResults = resultsByTag.get(toolTag)
				const toolResultsArray = Array.isArray(toolResults) ? toolResults : []
				results.push(toolResultsArray[currentIndex])
				indexByType.set(toolTag, currentIndex + 1)
			}
		}

		return results
	}

	async readContextFiles(filePaths: string[]): Promise<Map<string, string>> {
		const fileResults = (await this.executeToolByTag("TOOLFILE", filePaths)) as FileReadResult[]
		const fileContents = new Map<string, string>()

		for (const fileResult of fileResults) {
			if (fileResult.success) {
				fileContents.set(fileResult.filePath, fileResult.content)
			}
		}

		return fileContents
	}

	public updateContextWithToolResults(context: AgentContext, toolCalls: unknown[], toolResults: unknown[]): boolean {
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

	public shouldContinue(_context: AgentContext, foundNewContext: boolean, isReadyToAnswer: boolean): boolean {
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

	public formatResult(context: AgentContext, pathOnly = true): ToolResponse {
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
 * Builds the complete system prompt for SearchAgent.
 * Replaces all template placeholders with actual values.
 */
function buildSearchAgentSystemPrompt(userInput: string, contextPrompt: string, actionsTags: typeof ACTIONS_TAGS): string {
	const toolsPlaceholder = buildToolsPlaceholder(SEARCH_AGENT_TOOLS)

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
