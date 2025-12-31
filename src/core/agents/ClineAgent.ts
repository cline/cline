import { ApiHandler } from "@/core/api"
import { ClineHandler } from "@/core/api/providers/cline"
import type { ApiStream } from "@/core/api/transform/stream"
import { Logger } from "@/services/logging/Logger"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { ToolResponse } from "../task"
import type { TaskConfig } from "../task/tools/types/TaskConfig"
import type { ToolDefinition } from "./SubAgentTools"

export interface SearchResult {
	workspaceName?: string
	workspaceResults: string
	resultCount: number
	success: boolean
}

export interface AgentContext {
	filePaths: Set<string>
	searchResults: Map<string, SearchResult>
	fileContents: Map<string, string>
}

export interface FileReadResult {
	filePath: string
	content: string
	success: boolean
}

/**
 * Represents actions extracted from an agent's response
 */
export interface AgentActions {
	/** Tool calls to execute (e.g., search queries, file reads) */
	toolCalls: unknown[]
	/** Context files the agent wants to use in the final answer */
	contextFiles: string[]
	/** Whether the agent is ready to provide a final answer */
	isReadyToAnswer: boolean
}

/**
 * Progress update sent during agent iteration
 */
export interface AgentIterationUpdate {
	/** Current iteration number (0-indexed) */
	iteration: number
	/** Maximum iterations allowed */
	maxIterations: number
	/** Actions extracted from the agent's response */
	actions?: AgentActions
	/** Current context state */
	context?: unknown
	/** Cost incurred in this iteration */
	cost?: number
	/** Message describing the current status etc */
	message?: string
}

/**
 * Configuration for creating a ClineAgent instance
 */
export interface ClineAgentConfig {
	/** Model ID to use (e.g., "x-ai/grok-code-fast-1") */
	modelId: string
	/** Maximum number of iterations in the agentic loop */
	maxIterations?: number
	/** Callback for iteration progress updates */
	onIterationUpdate: (update: AgentIterationUpdate) => void | Promise<void>
	/** System Prompt for the agent */
	systemPrompt?: string
	/** Starting messages for the agent */
	messages?: ClineStorageMessage[]
	/** API Request Params */
	apiParams?: Record<string, unknown>
	/** Optional API client to use instead of the default ClineHandler */
	client?: ApiHandler
}

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
	protected tools: Map<string, ToolDefinition> = new Map()
	protected taskConfig?: TaskConfig

	private static agents: ClineAgent[] = []

	constructor(private config: ClineAgentConfig) {
		// Move this to individual subclasses to allow for different client configurations
		this.client = config.client ?? new ClineHandler({ openRouterModelId: config.modelId, ...config.apiParams })
		this.maxIterations = config.maxIterations ?? 3
		this.onIterationUpdate = config.onIterationUpdate
		ClineAgent.registerAgent(this)
	}

	private static registerAgent(agent: ClineAgent): void {
		ClineAgent.agents.push(agent)
	}

	static getAllAgentCosts(): number {
		let totalCost = 0
		for (const agent of ClineAgent.agents) {
			totalCost += agent.getCost()
			agent.resetCost()
		}
		Logger.debug(`Total cost across all agents: $${totalCost.toFixed(4)}`)
		return totalCost
	}

	/**
	 * Gets the accumulated cost from this agent execution
	 */
	public getCost(): number {
		return this.cost
	}

	/**
	 * Resets the cost counter
	 */
	private resetCost(): void {
		this.cost = 0
	}

	/**
	 * Registers tools for this agent
	 * @param toolDefinitions - Array of tool definitions to register
	 */
	protected registerTools(toolDefinitions: ToolDefinition[]): void {
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
	 * @example
	 */
	protected extractToolCalls(response: string): Map<string, string[]> {
		const toolCallsMap = new Map<string, string[]>()

		for (const [toolTag, toolDef] of this.tools) {
			const inputs: string[] = []
			const toolPattern = new RegExp(`<${toolTag}>(.*?)</${toolTag}>`, "gs")
			let toolMatch: RegExpExecArray | null

			toolMatch = toolPattern.exec(response)
			while (toolMatch !== null) {
				const toolContent = toolMatch[1]
				const subTagPattern = new RegExp(`<${toolDef.subTag}>(.*?)</${toolDef.subTag}>`, "gs")
				let subTagMatch: RegExpExecArray | null

				subTagMatch = subTagPattern.exec(toolContent)
				while (subTagMatch !== null) {
					const value = subTagMatch[1].trim()
					if (value) {
						inputs.push(value)
					}
					subTagMatch = subTagPattern.exec(toolContent)
				}

				toolMatch = toolPattern.exec(response)
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
	 * Extracts actions (tool calls, context files, ready status) from the agent's response
	 * @param response - The full response text from the agent
	 */
	abstract extractActions(response: string): AgentActions

	/**
	 * Generic tool execution that groups tool calls by tag and executes them in parallel.
	 * This is the recommended implementation for most agents.
	 * @param toolCallsMap - Map of tool tag to array of input values (use extractToolCalls to get this)
	 * @returns Promise resolving to map of tool tag to results
	 */
	protected async executeToolsByTag(toolCallsMap: Map<string, string[]>): Promise<Map<string, unknown>> {
		const startTime = performance.now()

		// Execute all tools in parallel
		const toolExecutionPromises = Array.from(toolCallsMap.entries()).map(([toolTag, inputs]) =>
			this.executeToolByTag(toolTag, inputs),
		)
		const toolExecutionResults = await Promise.all(toolExecutionPromises)

		// Create a map of tool results by tag
		const resultsByTag = new Map<string, unknown>()
		let resultIndex = 0
		for (const [toolTag] of toolCallsMap.entries()) {
			resultsByTag.set(toolTag, toolExecutionResults[resultIndex++])
		}

		const endTime = performance.now()
		const totalCalls = Array.from(toolCallsMap.values()).reduce((sum, arr) => sum + arr.length, 0)
		const msg = `Executed ${totalCalls} tool calls across ${toolCallsMap.size} tool types in ${endTime - startTime}ms`
		await this.onIterationUpdate({
			iteration: this.currentIteration,
			maxIterations: this.maxIterations,
			message: msg,
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
	private updateContextWithFiles(context: AgentContext, fileContents: Map<string, string>): void {
		for (const [filePath, content] of fileContents) {
			if (!context.fileContents.has(filePath)) {
				context.fileContents.set(filePath, content)
			}
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
				await this.onIterationUpdate?.({
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
			await this.onIterationUpdate?.({
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
