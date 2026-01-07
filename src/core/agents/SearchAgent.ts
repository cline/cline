import { AgentContext, AgentIterationUpdate, FileReadResult, SearchResult } from "@/shared/cline/subagent"
import { ToolResponse } from "../task"
import type { TaskConfig } from "../task/tools/types/TaskConfig"
import { ClineAgent } from "./ClineAgent"
import { SEARCH_AGENT_TOOLS } from "./tools"
import { buildToolsPlaceholder } from "./utils"

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
		super({
			modelId,
			maxIterations,
			onIterationUpdate,
			systemPrompt,
			contextTag: ACTIONS_TAGS.CONTEXT,
			answerTag: ACTIONS_TAGS.ANSWER,
		})
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

		const MAX_RESULTS_TO_SHOW = 5
		const contextParts: string[] = []
		const successfulQueries: string[] = []
		const unsuccessfulQueries: string[] = []

		// Process search results
		let shownResults = 0
		for (const [query, result] of context.searchResults) {
			if (result.success && result.resultCount > 0) {
				successfulQueries.push(query)
				if (shownResults < MAX_RESULTS_TO_SHOW) {
					contextParts.push(`### Search: "${query}"\n${result.workspaceResults}`)
					shownResults++
				} else {
					contextParts.push(
						`### Search: "${query}"\nFound ${result.resultCount} result${result.resultCount > 1 ? "s" : ""}`,
					)
				}
			} else {
				unsuccessfulQueries.push(query)
			}
		}

		// Add file contents
		for (const [filePath, content] of context.fileContents) {
			contextParts.push(`### File: ${filePath}\n\`\`\`\n${content}\n\`\`\``)
		}

		// Build header
		const totalSearches = context.searchResults.size
		const totalFiles = context.filePaths.size
		const totalFileContents = context.fileContents.size
		const parts = [
			`Retrieved context from ${totalSearches} search${totalSearches > 1 ? "es" : ""} (${totalFiles} unique file${totalFiles > 1 ? "s" : ""}) and ${totalFileContents} file content${totalFileContents > 1 ? "s" : ""}:\n`,
		]

		// Add search history
		if (successfulQueries.length > 0 || unsuccessfulQueries.length > 0) {
			parts.push("\n**Previously searched queries (DO NOT search these again):**")
			successfulQueries.forEach((q) => parts.push(`- "${q}" ✓ (found results)`))
			unsuccessfulQueries.forEach((q) => parts.push(`- "${q}" ✗ (no results)`))
			parts.push("")
		}

		return parts.join("\n") + contextParts.join("\n\n")
	}

	async readContextFiles(filePaths: string[]): Promise<Map<string, string>> {
		const fileResults = (await this.executeToolByTag("TOOLFILE", filePaths)) as FileReadResult[]
		const fileContents = new Map<string, string>()

		for (const fileResult of fileResults) {
			if (fileResult.success) {
				fileContents.set(fileResult.path, fileResult.content)
			}
		}

		return fileContents
	}

	public updateContextWithToolResults(context: AgentContext, toolCalls: unknown[], toolResults: unknown[]): boolean {
		const initialFileCount = context.filePaths.size
		const initialContentCount = context.fileContents.size

		for (let i = 0; i < toolCalls.length; i++) {
			const toolCall = toolCalls[i]
			const toolResult = toolResults[i]

			if (typeof toolCall === "object" && toolCall !== null) {
				const { toolTag, input } = toolCall as { toolTag: string; input: string }

				if (toolTag === "TOOLSEARCH" && toolResult) {
					const result = toolResult as SearchResult
					if (result.success && result.resultCount > 0) {
						this.extractFilePathsFromResult(result).forEach((fp) => context.filePaths.add(fp))
						context.searchResults.set(input, result)
					}
				} else if (toolTag === "TOOLFILE" && toolResult) {
					const fileResult = toolResult as FileReadResult
					if (fileResult.success && !context.fileContents.has(fileResult.path)) {
						context.fileContents.set(fileResult.path, fileResult.content)
					}
				}
			}
		}

		return context.filePaths.size > initialFileCount || context.fileContents.size > initialContentCount
	}

	public shouldContinue(_context: AgentContext, foundNewContext: boolean, isReadyToAnswer: boolean): boolean {
		return !isReadyToAnswer && foundNewContext && this.currentIteration < this.maxIterations - 1
	}

	public formatResult(context: AgentContext, pathOnly = true): ToolResponse {
		// Return file contents if available
		if (context.fileContents.size > 0) {
			const paths = Array.from(context.fileContents.keys())
			if (pathOnly) {
				const count = paths.length
				const label = count === 1 ? "1 file" : `${count} files`
				return `Search Agent returned ${label}:\n${paths.map((p) => `- ${p}`).join("\n")}`
			}
			return [...context.fileContents].map(([filePath, content]) => ({ type: "text", text: `${filePath}\n${content}` }))
		}

		// Return search results
		if (context.filePaths.size === 0) {
			return "No results found after searching."
		}

		const paths = Array.from(context.filePaths)
		const count = paths.length
		const label = count === 1 ? "1 file" : `${count} files`
		return `Found ${label} across multiple searches:\n${paths.map((p) => `- ${p}`).join("\n")}`
	}

	private extractFilePathsFromResult(result: SearchResult): string[] {
		return result.workspaceResults
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("│") && !line.startsWith("Found ") && !line.startsWith("Showing "))
	}
}

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
