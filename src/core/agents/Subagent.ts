import type { ApiHandler } from "@/core/api"
import { AgentContext, GeneralToolResult } from "@/shared/cline/subagent"
import { ToolResponse } from "../task"
import type { TaskConfig } from "../task/tools/types/TaskConfig"
import { ClineAgent } from "./ClineAgent"
import { TASK_AGENT_TOOLS } from "./tools"
import { buildToolsPlaceholder } from "./utils"

export const TASK_ACTIONS_TAGS = {
	ANSWER: `task_complete`,
	RESULT: `task_result`,
}

/**
 * TaskAgent extends ClineAgent to provide autonomous task execution functionality.
 * It can perform multi-step research and exploration tasks using search and bash tools,
 * returning a final result to the calling agent.
 */
export class Subagent extends ClineAgent {
	constructor(
		callId: string,
		prompt: string,
		taskConfig: TaskConfig,
		maxIterations: number = 30,
		systemPrompt?: string,
		client?: ApiHandler,
		abortSignal?: AbortSignal,
	) {
		super({
			callId,
			client,
			modelId: "moonshotai/kimi-k2.5", // Not used when client is provided
			maxIterations,
			prompt,
			systemPrompt,
			contextTag: TASK_ACTIONS_TAGS.RESULT,
			answerTag: TASK_ACTIONS_TAGS.ANSWER,
			abortSignal,
		})
		this.setTaskConfig(taskConfig)
		this.registerTools(TASK_AGENT_TOOLS)
	}

	buildSystemPrompt(userInput: string, contextPrompt: string): string {
		return buildTaskAgentSystemPrompt(userInput, contextPrompt, TASK_ACTIONS_TAGS)
	}

	buildContextPrompt(context: AgentContext, iteration: number): string {
		if (iteration === 0 || (context.searchResults.size === 0 && context.fileContents.size === 0)) {
			return "No context retrieved yet. Use the available tools to gather information."
		}

		const MAX_RESULTS_TO_SHOW = 10
		const contextParts: string[] = []
		const successfulSearches: string[] = []
		const failedSearches: { query: string; error?: string }[] = []
		const successfulCommands: string[] = []
		const failedCommands: { query: string; error?: string }[] = []

		// Process search results
		let shownSearchResults = 0
		for (const [query, result] of context.searchResults) {
			if (result.agent === "TOOLSEARCH") {
				if (result.success) {
					successfulSearches.push(query)
					if (shownSearchResults < MAX_RESULTS_TO_SHOW) {
						contextParts.push(`### Search: "${query}"\n${result.result}`)
						shownSearchResults++
					} else {
						contextParts.push(`### Search: "${query}"\nFound results (truncated)`)
					}
				} else {
					failedSearches.push({ query, error: result.error })
				}
			} else if (result.agent === "TOOLBASH") {
				if (result.success) {
					successfulCommands.push(query)
					contextParts.push(`### Command: \`${query}\`\n\`\`\`\n${result.result}\n\`\`\``)
				} else {
					failedCommands.push({ query, error: result.error })
				}
			}
		}

		// Add file contents
		for (const [filePath, content] of context.fileContents) {
			contextParts.push(`### File: ${filePath}\n\`\`\`\n${content}\n\`\`\``)
		}

		// Build header
		const totalSearches = successfulSearches.length + failedSearches.length
		const totalFiles = context.fileContents.size
		const totalCommands = successfulCommands.length + failedCommands.length
		const parts = [`## Retrieved Context\nSearches: ${totalSearches} | Files: ${totalFiles} | Commands: ${totalCommands}\n`]

		// Add search history
		if (successfulSearches.length > 0 || failedSearches.length > 0) {
			parts.push("\n**Previously executed searches (avoid duplicating):**")
			successfulSearches.forEach((q) => parts.push(`- "${q}" ✓`))
			failedSearches.forEach(({ query, error }) =>
				parts.push(`- "${query}" ✗ ${error ? `(error: ${error})` : "(no results)"}`),
			)
			parts.push("")
		}

		// Add command history
		if (successfulCommands.length > 0 || failedCommands.length > 0) {
			parts.push("\n**Previously executed commands:**")
			successfulCommands.forEach((cmd) => parts.push(`- \`${cmd}\` ✓`))
			failedCommands.forEach(({ query, error }) =>
				parts.push(`- \`${query}\` ✗ ${error ? `(error: ${error})` : "(failed)"}`),
			)
			parts.push("")
		}

		return parts.join("\n") + contextParts.join("\n\n")
	}

	async readContextFiles(filePaths: string[]): Promise<Map<string, string>> {
		const fileResults = (await this.executeToolByTag("TOOLFILE", filePaths)) as GeneralToolResult[]
		const fileContents = new Map<string, string>()

		for (const fileResult of fileResults) {
			if (fileResult.success) {
				fileContents.set(fileResult.query, fileResult.result)
			}
		}

		return fileContents
	}

	public updateContextWithToolResults(context: AgentContext, toolCalls: unknown[], toolResults: unknown[]): boolean {
		const initialSearchCount = context.searchResults.size
		const initialFileCount = context.fileContents.size

		for (let i = 0; i < toolCalls.length; i++) {
			const toolCall = toolCalls[i]
			const toolResult = toolResults[i]

			if (typeof toolCall === "object" && toolCall !== null) {
				const { toolTag, input } = toolCall as { toolTag: string; input: string }

				if (toolTag === "TOOLSEARCH" && toolResult) {
					const result = toolResult as GeneralToolResult
					// Store both successful and failed results so the agent knows what was tried
					if (result.success) {
						this.extractFilePathsFromResult(result).forEach((fp) => context.filePaths.add(fp))
					}
					context.searchResults.set(input, result)
				} else if (toolTag === "TOOLFILE" && toolResult) {
					const fileResult = toolResult as GeneralToolResult
					if (fileResult.success && !context.fileContents.has(fileResult.query)) {
						context.fileContents.set(fileResult.query, fileResult.result)
					}
				} else if (toolTag === "TOOLBASH" && toolResult) {
					const bashResult = toolResult as GeneralToolResult
					// Store bash results in searchResults map for context tracking
					context.searchResults.set(input, bashResult)
				}
			}
		}

		return context.searchResults.size > initialSearchCount || context.fileContents.size > initialFileCount
	}

	public shouldContinue(_context: AgentContext, foundNewContext: boolean, isReadyToAnswer: boolean): boolean {
		// Continue if not ready to answer and either found new context or haven't exhausted iterations
		return !isReadyToAnswer && foundNewContext && this.currentIteration < this.maxIterations - 1
	}

	public formatResult(context: AgentContext): ToolResponse {
		// If the agent provided a result text, return it directly
		if (context.resultText) {
			return context.resultText
		}

		// Fallback: collect all gathered information
		const parts: string[] = []

		// Add file contents
		if (context.fileContents.size > 0) {
			parts.push(`## Files Read (${context.fileContents.size})`)
			for (const [filePath, content] of context.fileContents) {
				parts.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``)
			}
		}

		// Add search results summary
		const searchResults = Array.from(context.searchResults.entries()).filter(([_, r]) => r.agent === "TOOLSEARCH")
		if (searchResults.length > 0) {
			parts.push(`## Search Results (${searchResults.length})`)
			for (const [query, result] of searchResults) {
				if (result.success) {
					parts.push(`### Search: "${query}"\n${result.result}`)
				}
			}
		}

		// Add bash command results
		const bashResults = Array.from(context.searchResults.entries()).filter(([_, r]) => r.agent === "TOOLBASH")
		if (bashResults.length > 0) {
			parts.push(`## Command Results (${bashResults.length})`)
			for (const [cmd, result] of bashResults) {
				if (result.success) {
					parts.push(`### \`${cmd}\`\n\`\`\`\n${result.result}\n\`\`\``)
				}
			}
		}

		if (parts.length === 0) {
			return "Task completed but no results were gathered."
		}

		return parts.join("\n\n")
	}

	private extractFilePathsFromResult(result: GeneralToolResult): string[] {
		return result.result
			.split("\n")
			.map((line: string) => line.trim())
			.filter((line: string) => line && !line.startsWith("│") && !line.startsWith("Found ") && !line.startsWith("Showing "))
	}
}

/**
 * Builds the complete system prompt for TaskAgent.
 */
function buildTaskAgentSystemPrompt(userInput: string, contextPrompt: string, actionsTags: typeof TASK_ACTIONS_TAGS): string {
	const toolsPlaceholder = buildToolsPlaceholder(TASK_AGENT_TOOLS)

	return `You are an autonomous task execution agent. Your job is to complete the given task by gathering information and performing research using the available tools.

## YOUR TASK
${userInput}

## CURRENT CONTEXT
${contextPrompt}

## TOOLS
Available tools:
${toolsPlaceholder}

## RESPONSE FORMAT
Your response must contain ONLY tags (no explanations, no markdown blocks outside tags). Choose one:

**If you have completed the task and have the answer:**
- Include your findings in <${actionsTags.RESULT}> tags
- End with <${actionsTags.ANSWER}>
- Example: <${actionsTags.RESULT}>Your detailed findings and conclusions here</${actionsTags.RESULT}><${actionsTags.ANSWER}>

**If you need more information:**
- Use tool tags to gather information
- You can use multiple tools in a single response
- Example: <TOOLSEARCH><query>class DatabaseController</query></TOOLSEARCH><TOOLFILE><name>src/config.ts</name></TOOLFILE>

## RULES
1. Work autonomously - gather all information needed to complete the task
2. Use search to find relevant files, then read them to understand the code
3. Use bash commands for system operations, git commands, or exploring the filesystem
4. Be thorough - check multiple sources before concluding
5. Your final <${actionsTags.RESULT}> should contain a complete, actionable answer
6. Response must be ONLY tags, nothing else
7. DO NOT repeat searches or commands you've already executed

## IMPORTANT
- You cannot ask questions - work with what you have
- Your output will be returned to the calling agent, so be comprehensive
- If you cannot complete the task, explain what you found and what's missing

Remember: Your response will be parsed by a bot. Only include the expected tags.`
}
