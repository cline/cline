import { ApiHandler } from "@/core/api"
import { ClineHandler } from "@/core/api/providers/cline"
import type { ApiStream } from "@/core/api/transform/stream"
import { Logger } from "@/services/logging/Logger"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { ToolResponse } from "../task"
import type { TaskConfig } from "../task/tools/types/TaskConfig"
import { AgentActions, AgentContext, AgentIterationUpdate, ClineAgentConfig, SearchResult } from "."
import { SubAgentToolDefinition } from "./SubAgentTools"
import { extractTagContent } from "./utils"

/**
 * Abstract base class for agentic loops using ClineHandler.
 * Subclasses implement domain-specific logic for context management, tool execution, and result formatting.
 */
export abstract class ClineAgent {
	protected readonly client: ApiHandler
	protected currentIteration: number = 0
	protected readonly maxIterations: number
	protected readonly onIterationUpdate: (update: AgentIterationUpdate) => void | Promise<void>
	protected cost = 0
	protected readonly tools: Map<string, SubAgentToolDefinition> = new Map()
	protected taskConfig?: TaskConfig

	private static activeAgents = new Set<ClineAgent>()

	constructor(private config: ClineAgentConfig) {
		this.client = config.client ?? new ClineHandler({ openRouterModelId: config.modelId, ...config.apiParams })
		this.maxIterations = config.maxIterations ?? 3
		this.onIterationUpdate = config.onIterationUpdate
		ClineAgent.activeAgents.add(this)
	}

	/**
	 * Collects and resets costs from all active agents
	 */
	static getAllAgentCosts(): number {
		let totalCost = 0
		for (const agent of ClineAgent.activeAgents) {
			totalCost += agent.cost
			agent.cost = 0
		}
		ClineAgent.activeAgents.clear()
		Logger.debug(`Total cost across all agents: $${totalCost.toFixed(4)}`)
		return totalCost
	}

	/**
	 * Registers tools for this agent
	 * @param toolDefinitions - Array of tool definitions to register
	 */
	protected registerTools(toolDefinitions: SubAgentToolDefinition[]): void {
		for (const tool of toolDefinitions) {
			this.tools.set(tool.tag, tool)
		}
	}

	/**
	 * Sets the task config for this agent (required for tool execution)
	 * @param taskConfig - The task configuration
	 */
	public setTaskConfig(taskConfig: TaskConfig): void {
		this.taskConfig = taskConfig
	}

	/**
	 * Extracts tool calls from agent response based on registered tools.
	 * Parses the response for tool tags and extracts subtag values.
	 * @param response - The agent's response text
	 * @returns Map of tool tag to array of extracted input values
	 */
	protected extractToolCalls(response: string): Map<string, string[]> {
		const toolCallsMap = new Map<string, string[]>()

		for (const [toolTag, toolDef] of this.tools) {
			const toolPattern = new RegExp(`<${toolTag}>(.*?)</${toolTag}>`, "gs")
			const subTagPattern = new RegExp(`<${toolDef.subTag}>(.*?)</${toolDef.subTag}>`, "gs")
			const inputs: string[] = []

			for (const toolMatch of response.matchAll(toolPattern)) {
				const toolContent = toolMatch[1]
				for (const subTagMatch of toolContent.matchAll(subTagPattern)) {
					const value = subTagMatch[1].trim()
					if (value) {
						inputs.push(value)
					}
				}
			}

			if (inputs.length > 0) {
				toolCallsMap.set(toolTag, inputs)
			}
		}

		return toolCallsMap
	}

	/**
	 * Executes a tool by its tag name
	 * @param toolTag - The tool tag (e.g., "TOOLFILE", "TOOLSEARCH")
	 * @param inputs - Array of input values for the tool
	 * @returns Promise resolving to the tool execution result
	 */
	protected async executeToolByTag(toolTag: string, inputs: string[]): Promise<unknown> {
		const tool = this.tools.get(toolTag)
		if (!tool) {
			throw new Error(`Tool with tag "${toolTag}" not found in registered tools`)
		}
		if (!this.taskConfig) {
			throw new Error(`TaskConfig not set. Call setTaskConfig() before executing tools.`)
		}
		return await tool.execute(inputs, this.taskConfig)
	}

	/**
	 * Builds the system prompt for the agent
	 * @param userInput - The user's input/query
	 * @param contextPrompt - The current context prompt
	 */
	abstract buildSystemPrompt(userInput: string, contextPrompt: string): string

	/**
	 * Builds the context prompt for the current iteration
	 * @param context - The current agent context
	 * @param iteration - Current iteration number (0-indexed)
	 */
	abstract buildContextPrompt(context: AgentContext, iteration: number): string

	/**
	 * Generic implementation of extractActions using registered tools and config tags.
	 * Extracts tool calls based on registered tools, context files, and ready-to-answer status.
	 * @param response - The full response text from the agent
	 */
	protected extractActions(response: string): AgentActions {
		// Extract context files if contextTag is configured
		const contextFiles = this.config.contextTag ? extractTagContent(response, this.config.contextTag) : []

		// Check if ready to answer if answerTag is configured
		const isReadyToAnswer = this.config.answerTag ? response.includes(`<${this.config.answerTag}>`) : false

		// Extract tool calls based on registered tools
		const toolCallsMap = this.extractToolCalls(response)

		// Convert tool calls map to array format
		const toolCalls: unknown[] = []
		for (const [toolTag, inputs] of toolCallsMap) {
			for (const input of inputs) {
				toolCalls.push({ toolTag, input })
			}
		}

		return {
			toolCalls,
			contextFiles,
			isReadyToAnswer,
		}
	}

	/**
	 * Generic tool execution that groups tool calls by tag and executes them in parallel.
	 * This is the recommended implementation for most agents.
	 * @param toolCallsMap - Map of tool tag to array of input values (use extractToolCalls to get this)
	 * @returns Promise resolving to map of tool tag to results
	 */
	protected async executeToolsByTag(toolCallsMap: Map<string, string[]>): Promise<Map<string, unknown>> {
		const startTime = performance.now()
		const entries = Array.from(toolCallsMap.entries())

		// Execute all tools in parallel
		const results = await Promise.all(entries.map(([toolTag, inputs]) => this.executeToolByTag(toolTag, inputs)))

		// Build result map
		const resultsByTag = new Map(entries.map(([toolTag], i) => [toolTag, results[i]]))

		const totalCalls = entries.reduce((sum, [, inputs]) => sum + inputs.length, 0)
		const duration = performance.now() - startTime
		await this.onIterationUpdate({
			iteration: this.currentIteration,
			maxIterations: this.maxIterations,
			message: `Executed ${totalCalls} tool calls across ${toolCallsMap.size} tool types in ${duration.toFixed(0)}ms`,
		})

		return resultsByTag
	}

	/**
	 * Executes tool calls in parallel
	 * @param toolCalls - Array of tool calls to execute
	 * @returns Promise resolving to array of tool results
	 */
	abstract executeTools(toolCalls: unknown[]): Promise<unknown[]>

	/**
	 * Reads context files in parallel
	 * @param filePaths - Array of file paths to read
	 * @returns Promise resolving to a map of file path to content
	 */
	abstract readContextFiles(filePaths: string[]): Promise<Map<string, string>>

	/**
	 * Updates the context with new tool results
	 * @param context - Current context
	 * @param toolCalls - Tool calls that were executed
	 * @param toolResults - Results from tool execution
	 * @returns Whether new context was found
	 */
	abstract updateContextWithToolResults(context: AgentContext, toolCalls: unknown[], toolResults: unknown[]): boolean

	/**
	 * Updates the context with file contents
	 * @param context - Current context
	 * @param fileContents - Map of file path to content
	 */
	protected updateContextWithFiles(context: AgentContext, fileContents: Map<string, string>): void {
		for (const [filePath, content] of fileContents) {
			context.fileContents.set(filePath, content)
		}
	}

	/**
	 * Determines if the agent should continue iterating
	 * @param context - Current context
	 * @param iteration - Current iteration number
	 * @param foundNewContext - Whether new context was found in this iteration
	 * @param isReadyToAnswer - Whether the agent is ready to answer
	 */
	abstract shouldContinue(context: AgentContext, foundNewContext: boolean, isReadyToAnswer: boolean): boolean

	/**
	 * Formats the final result from the context
	 * @param context - Final context state
	 */
	abstract formatResult(context: AgentContext): ToolResponse

	/**
	 * Creates the initial context for the agent
	 */
	private createInitialContext(): AgentContext {
		return {
			filePaths: new Set<string>(),
			searchResults: new Map<string, SearchResult>(),
			fileContents: new Map<string, string>(),
		}
	}

	/**
	 * Processes a streaming response and accumulates text and cost
	 */
	private async processStream(stream: ApiStream): Promise<string> {
		const parts: string[] = []

		for await (const msg of stream) {
			if (msg.type === "text") {
				parts.push(msg.text)
			}

			if (msg.type === "usage" && msg.totalCost) {
				this.cost += msg.totalCost
				await this.onIterationUpdate({
					iteration: this.currentIteration,
					maxIterations: this.maxIterations,
					cost: msg.totalCost,
				})
			}
		}

		return parts.join("")
	}

	/**
	 * Executes the agentic loop
	 * @param userInput - The user's input/query
	 * @returns Promise resolving to the final result
	 */
	public async execute(userInput: string): Promise<ToolResponse> {
		const startTime = performance.now()
		const context = this.createInitialContext()

		for (let iteration = 0; iteration < this.maxIterations; iteration++) {
			this.currentIteration = iteration + 1

			// Build context prompt and system prompt
			const contextPrompt = this.buildContextPrompt(context, iteration)
			const systemPrompt = this.buildSystemPrompt(userInput, contextPrompt)

			// Create messages
			const messages: ClineStorageMessage[] = this.config.messages
				? [...this.config.messages, { role: "user", content: userInput }]
				: [{ role: "user", content: userInput }]

			// Stream the LLM response
			const stream = this.client.createMessage(systemPrompt, messages)
			const fullResponse = await this.processStream(stream)

			Logger.log(`Iteration ${this.currentIteration} response: ${fullResponse.substring(0, 200)}`)

			// Extract actions from response
			const actions = this.extractActions(fullResponse)

			// Send iteration update
			await this.onIterationUpdate({
				iteration,
				maxIterations: this.maxIterations,
				actions,
				context,
			})

			// If ready to answer and has context files, read them first
			if (actions.isReadyToAnswer && actions.contextFiles.length > 0) {
				Logger.log(
					`Reading ${actions.contextFiles.length} context files before answering: ${actions.contextFiles.join(", ")}`,
				)
				const fileContents = await this.readContextFiles(actions.contextFiles)
				this.updateContextWithFiles(context, fileContents)
				Logger.log("Agent determined it has enough context to answer.")
				break
			}

			// If ready to answer without context files, break immediately
			if (actions.isReadyToAnswer) {
				Logger.log("Agent determined it has enough context to answer.")
				break
			}

			// If no tool calls, end the loop
			if (actions.toolCalls.length === 0) {
				Logger.log("No tool calls generated, ending loop.")
				break
			}

			// Execute tools in parallel
			Logger.log(`Executing ${actions.toolCalls.length} tool calls`)
			const toolResults = await this.executeTools(actions.toolCalls)

			// Update context with tool results
			const foundNewContext = this.updateContextWithToolResults(context, actions.toolCalls, toolResults)

			// Check if we should continue
			if (!this.shouldContinue(context, foundNewContext, false)) {
				Logger.log("Agent determined it should stop iterating.")
				break
			}
		}
		const duration = performance.now() - startTime
		Logger.debug("Agent completed in " + duration)

		// Format and return final result
		return this.formatResult(context)
	}
}
