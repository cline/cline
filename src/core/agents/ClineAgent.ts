import { ApiHandler } from "@/core/api"
import { ClineHandler } from "@/core/api/providers/cline"
import type { ApiStream } from "@/core/api/transform/stream"
import { Logger } from "@/services/logging/Logger"
import type { ClineStorageMessage } from "@/shared/messages/content"
import type { ToolResponse } from "../task"

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
export abstract class ClineAgent<TContext> {
	protected readonly client: ApiHandler
	protected currentIteration: number = 0
	protected readonly maxIterations: number
	protected readonly onIterationUpdate: (update: AgentIterationUpdate) => void | Promise<void>
	protected cost = 0

	constructor(private config: ClineAgentConfig) {
		// Move this to individual subclasses to allow for different client configurations
		this.client = config.client ?? new ClineHandler({ openRouterModelId: config.modelId, ...config.apiParams })
		this.maxIterations = config.maxIterations ?? 3
		this.onIterationUpdate = config.onIterationUpdate
	}

	/**
	 * Gets the accumulated cost from this agent execution
	 */
	getCost(): number {
		return this.cost
	}

	/**
	 * Resets the cost counter
	 */
	resetCost(): void {
		this.cost = 0
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
	abstract buildContextPrompt(context: TContext, iteration: number): string

	/**
	 * Extracts actions (tool calls, context files, ready status) from the agent's response
	 * @param response - The full response text from the agent
	 */
	abstract extractActions(response: string): AgentActions

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
	abstract updateContextWithToolResults(context: TContext, toolCalls: unknown[], toolResults: unknown[]): boolean

	/**
	 * Updates the context with file contents
	 * @param context - Current context
	 * @param fileContents - Map of file path to content
	 */
	abstract updateContextWithFiles(context: TContext, fileContents: Map<string, string>): void

	/**
	 * Determines if the agent should continue iterating
	 * @param context - Current context
	 * @param iteration - Current iteration number
	 * @param foundNewContext - Whether new context was found in this iteration
	 * @param isReadyToAnswer - Whether the agent is ready to answer
	 */
	abstract shouldContinue(context: TContext, foundNewContext: boolean, isReadyToAnswer: boolean): boolean

	/**
	 * Formats the final result from the context
	 * @param context - Final context state
	 */
	abstract formatResult(context: TContext): ToolResponse

	/**
	 * Creates the initial context for the agent
	 */
	abstract createInitialContext(): TContext

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
	async execute(userInput: string): Promise<ToolResponse> {
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

			console.log(`Iteration ${this.currentIteration} response:`, fullResponse.substring(0, 200))

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
				console.log(`Reading ${actions.contextFiles.length} context files before answering:`, actions.contextFiles)
				const fileContents = await this.readContextFiles(actions.contextFiles)
				this.updateContextWithFiles(context, fileContents)
				console.log("Agent determined it has enough context to answer.")
				break
			}

			// If ready to answer without context files, break immediately
			if (actions.isReadyToAnswer) {
				console.log("Agent determined it has enough context to answer.")
				break
			}

			// If no tool calls, end the loop
			if (actions.toolCalls.length === 0) {
				console.log("No tool calls generated, ending loop.")
				break
			}

			// Execute tools in parallel
			console.log(`Executing ${actions.toolCalls.length} tool calls`)
			const toolResults = await this.executeTools(actions.toolCalls)

			// Update context with tool results
			const foundNewContext = this.updateContextWithToolResults(context, actions.toolCalls, toolResults)

			// Check if we should continue
			if (!this.shouldContinue(context, foundNewContext, false)) {
				console.log("Agent determined it should stop iterating.")
				break
			}
		}
		const duration = performance.now() - startTime
		Logger.debug("Agent completed in " + duration)

		// Format and return final result
		return this.formatResult(context)
	}
}
