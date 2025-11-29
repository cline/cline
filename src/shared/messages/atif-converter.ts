/**
 * ATIF Conversion Utilities
 *
 * Functions for converting between Cline storage format and ATIF trajectory format.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import type { ClineApiReqInfo, ClineMessage } from "../ExtensionMessage"
import type {
	ATIF_AGENT_NAME,
	ATIF_SCHEMA_VERSION,
	ATIFAgentSchema,
	ATIFObservationResultSchema,
	ATIFStepObject,
	ATIFToolCallSchema,
	ATIFTrajectory,
} from "./atif"
import {
	ClineAssistantThinkingBlock,
	type ClineAssistantToolUseBlock,
	type ClineContent,
	type ClineStorageMessage,
	type ClineUserToolResultContentBlock,
} from "./content"

/**
 * Enriches API conversation history messages with metrics from UI messages.
 * Matches assistant messages to their corresponding api_req_started messages
 * to populate the metrics field for ATIF export.
 *
 * @param apiConversationHistory - The API conversation history messages
 * @param clineMessages - The UI messages containing api_req_started with metrics
 * @returns A new array of messages with metrics populated
 */
export function enrichMessagesWithMetrics(
	apiConversationHistory: ClineStorageMessage[],
	clineMessages: ClineMessage[],
): ClineStorageMessage[] {
	// Find all api_req_started messages with their metrics
	const apiReqMessages = clineMessages
		.filter((m) => m.type === "say" && m.say === "api_req_started" && m.text)
		.map((m) => {
			try {
				const info: ClineApiReqInfo = JSON.parse(m.text || "{}")
				return {
					ts: m.ts,
					tokensIn: info.tokensIn,
					tokensOut: info.tokensOut,
					cacheWrites: info.cacheWrites,
					cacheReads: info.cacheReads,
					cost: info.cost,
				}
			} catch {
				return null
			}
		})
		.filter((m) => m !== null)

	// Create a copy of the conversation history and enrich assistant messages
	let apiReqIndex = 0
	return apiConversationHistory.map((message) => {
		if (message.role === "assistant" && apiReqIndex < apiReqMessages.length) {
			const metrics = apiReqMessages[apiReqIndex]
			apiReqIndex++

			// Only add metrics if we have valid data
			if (metrics && typeof metrics.tokensIn === "number" && typeof metrics.tokensOut === "number") {
				return {
					...message,
					metrics: {
						promptTokens: metrics.tokensIn,
						completionTokens: metrics.tokensOut,
						cachedTokens: (metrics.cacheWrites || 0) + (metrics.cacheReads || 0),
						totalCost: metrics.cost || 0,
					},
				}
			}
		}
		return message
	})
}

/**
 * Options for converting Cline messages to ATIF trajectory
 */
export interface ClineToATIFOptions {
	sessionId: string
	agentVersion: string
	defaultModelName?: string
	notes?: string
	agentName?: typeof ATIF_AGENT_NAME
	schemaVersion?: typeof ATIF_SCHEMA_VERSION
	/** Optional: UI messages to extract metrics from */
	clineMessages?: ClineMessage[]
}

/**
 * Converts an array of ClineStorageMessages to an ATIF trajectory
 */
export function convertClineMessagesToATIF(messages: ClineStorageMessage[], options: ClineToATIFOptions): ATIFTrajectory {
	const agent: ATIFAgentSchema = {
		name: options.agentName || "cline",
		version: options.agentVersion,
		model_name: options.defaultModelName,
		extra: {},
	}

	// Enrich messages with metrics if clineMessages are provided
	const enrichedMessages = options.clineMessages ? enrichMessagesWithMetrics(messages, options.clineMessages) : messages

	// Convert messages to steps
	const steps: ATIFStepObject[] = []
	let stepId = 1

	for (const message of enrichedMessages) {
		const step = convertClineMessageToATIFStep(message, stepId)
		steps.push(step)
		stepId++
	}

	// Calculate final metrics
	const final_metrics = calculateFinalMetrics(steps)

	return {
		schema_version: options.schemaVersion || "ATIF-v1.3",
		session_id: options.sessionId,
		agent,
		steps,
		notes: options.notes,
		final_metrics,
		extra: {},
	}
}

/**
 * Converts a single ClineStorageMessage to an ATIF step
 */
export function convertClineMessageToATIFStep(message: ClineStorageMessage, stepId: number): ATIFStepObject {
	// Determine source from role
	const source = message.role === "assistant" ? "agent" : message.role

	// Extract message text
	const messageText = extractMessageText(message.content)

	// Extract tool calls (for assistant messages)
	const tool_calls = message.role === "assistant" ? extractToolCalls(message.content) : undefined

	// Extract observations (from tool results in user messages or from message.observation)
	// const observation = message.observation || extractObservationFromContent(message.content)

	// Build step object
	const step: ATIFStepObject = {
		step_id: stepId,
		timestamp: message.timestamp || new Date().toISOString(),
		source,
		message: messageText,
		// extra: message.extra,
	}

	// Add agent-specific fields
	if (source === "agent") {
		if (message.modelInfo?.modelId) {
			step.model_name = message.modelInfo.modelId
		}
		if (message.modelInfo?.reasoningEffort !== undefined) {
			step.reasoning_effort = message.modelInfo.reasoningEffort
		}
		if (message.content && Array.isArray(message.content)) {
			const thinkingBlock = message.content.find((b) => b.type === "thinking")
			step.reasoning_content = thinkingBlock?.thinking
		}
		if (tool_calls && tool_calls.length > 0) {
			step.tool_calls = tool_calls
		}
		if (message.metrics) {
			step.metrics = {
				prompt_tokens: message.metrics.promptTokens || 0,
				completion_tokens: message.metrics.completionTokens || 0,
				cached_tokens: message.metrics.cachedTokens || 0,
				cost_usd: message.metrics.totalCost || 0,
			}
		}
	}

	// // Add observation if present
	// if (observation && observation.results.length > 0) {
	// 	step.observation = observation
	// }

	return step
}

/**
 * Extracts text content from message content
 */
function extractMessageText(content: string | ClineContent[]): string {
	if (typeof content === "string") {
		return content
	}

	// Find the first text block
	const textBlock = content.find((block) => block.type === "text")
	if (textBlock && "text" in textBlock) {
		return textBlock.text
	}

	return ""
}

/**
 * Extracts tool calls from assistant message content
 */
function extractToolCalls(content: string | ClineContent[]): ATIFToolCallSchema[] | undefined {
	if (typeof content === "string") {
		return undefined
	}

	const toolCalls: ATIFToolCallSchema[] = []

	for (const block of content) {
		if (block.type === "tool_use") {
			const toolUseBlock = block as ClineAssistantToolUseBlock
			toolCalls.push({
				tool_call_id: toolUseBlock.id,
				function_name: toolUseBlock.name,
				arguments: toolUseBlock.input as Record<string, unknown>,
			})
		}
	}

	return toolCalls.length > 0 ? toolCalls : undefined
}

/**
 * Extracts observation data from message content (tool results)
 */
export function extractObservationFromContent(
	content: string | ClineContent[],
): { results: ATIFObservationResultSchema[] } | undefined {
	if (typeof content === "string") {
		return undefined
	}

	const results: ATIFObservationResultSchema[] = []

	for (const block of content) {
		if (block.type === "tool_result") {
			const toolResultBlock = block as ClineUserToolResultContentBlock
			const resultContent = toolResultBlock.content ? extractToolResultContent(toolResultBlock.content) : ""

			results.push({
				source_call_id: toolResultBlock.tool_use_id,
				content: resultContent,
			})
		}
	}

	return results.length > 0 ? { results } : undefined
}

/**
 * Extracts text content from tool result content
 */
function extractToolResultContent(content: string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>): string {
	if (typeof content === "string") {
		return content
	}

	// Concatenate all text blocks
	const textParts: string[] = []
	for (const block of content) {
		if (block.type === "text") {
			textParts.push(block.text)
		}
	}

	return textParts.join("\n")
}

/**
 * Calculates aggregate metrics for the entire trajectory
 */
function calculateFinalMetrics(steps: ATIFStepObject[]) {
	let total_prompt_tokens = 0
	let total_completion_tokens = 0
	let total_cached_tokens = 0
	let total_cost_usd = 0

	for (const step of steps) {
		if (step.metrics) {
			total_prompt_tokens += step.metrics.prompt_tokens || 0
			total_completion_tokens += step.metrics.completion_tokens || 0
			total_cached_tokens += step.metrics.cached_tokens || 0
			total_cost_usd += step.metrics.cost_usd || 0
		}
	}

	return {
		total_prompt_tokens,
		total_completion_tokens,
		total_cached_tokens,
		total_cost_usd,
		total_steps: steps.length,
		extra: {},
	}
}

/**
 * Converts an ATIF step back to a ClineStorageMessage
 * Useful for importing ATIF trajectories into Cline format
 */
export function convertATIFStepToClineMessage(step: ATIFStepObject): ClineStorageMessage {
	// Determine role from source
	const role = step.source === "agent" ? "assistant" : "user"

	// Build content array
	const content: ClineContent[] = []

	// Add main message as text block
	if (step.message) {
		content.push({
			type: "text",
			text: step.message,
		})
	}

	// Add tool calls (for agent steps)
	if (step.tool_calls) {
		for (const toolCall of step.tool_calls) {
			content.push({
				type: "tool_use",
				id: toolCall.tool_call_id,
				name: toolCall.function_name,
				input: toolCall.arguments,
			})
		}
	}

	// Add tool results (if observation is present)
	if (step.observation) {
		for (const result of step.observation.results) {
			if (result.source_call_id) {
				content.push({
					type: "tool_result",
					tool_use_id: result.source_call_id,
					content: result.content || "",
				})
			}
		}
	}

	// Build the message
	const message: ClineStorageMessage = {
		role,
		content: content.length === 1 && content[0].type === "text" ? content[0].text : content,
		timestamp: step.timestamp,
	}

	// Add agent-specific fields
	if (role === "assistant") {
		if (!step.model_name) {
			throw new Error("Model name is required for assistant messages")
		}

		message.modelInfo = {
			modelId: step.model_name,
			providerId: "unknown", // Provider info not in ATIF
			reasoningEffort: step.reasoning_effort,
		}

		if (step.reasoning_content) {
			const thinkingBlock: ClineAssistantThinkingBlock = {
				type: "thinking",
				thinking: step.reasoning_content,
				// TODO: signature should be provided if needed
				signature: step.step_id.toString(),
			}
			if (Array.isArray(message.content)) {
				message.content.unshift(thinkingBlock)
			} else {
				message.content = [thinkingBlock, { type: "text", text: message.content }]
			}
		}

		if (step.metrics) {
			message.metrics = {
				promptTokens: step.metrics.prompt_tokens || 0,
				completionTokens: step.metrics.completion_tokens || 0,
				cachedTokens: step.metrics.cached_tokens || 0,
				totalCost: step.metrics.cost_usd || 0,
			}
		}
		// message.observation = step.observation
	}

	return message
}

/**
 * Converts an entire ATIF trajectory to an array of ClineStorageMessages
 */
export function convertATIFToClineMessages(trajectory: ATIFTrajectory): ClineStorageMessage[] {
	return trajectory.steps.map((step) => convertATIFStepToClineMessage(step))
}

/**
 * Validates that a message can be converted to ATIF format
 * Returns validation errors if any
 */
export function validateClineMessageForATIF(message: ClineStorageMessage): string[] {
	const errors: string[] = []

	// Check role
	if (!message.role) {
		errors.push("Message must have a role")
	}

	// Check content
	if (!message.content) {
		errors.push("Message must have content")
	}

	// Check agent-specific fields are only on assistant messages
	if (message.role !== "assistant") {
		if (message.modelInfo?.reasoningEffort !== undefined) {
			errors.push("reasoning_effort can only be set on assistant messages")
		}
		// Check for reasoning_content in message.content
		if (
			Array.isArray(message.content) &&
			message.content.some((block: any) => block.type === "reasoning_content" || block.reasoning_content !== undefined)
		) {
			errors.push("reasoning_content can only be set on assistant messages")
		} else if (typeof message.content === "object" && message.content !== null && "reasoning_content" in message.content) {
			errors.push("reasoning_content can only be set on assistant messages")
		}
		if (message.metrics) {
			errors.push("metrics can only be set on assistant messages")
		}
	}

	return errors
}

/**
 * Serializes an ATIF trajectory to JSON string
 */
export function serializeATIFTrajectory(trajectory: ATIFTrajectory, pretty = true): string {
	return JSON.stringify(trajectory, null, pretty ? 2 : 0)
}

/**
 * Parses an ATIF trajectory from JSON string
 */
export function parseATIFTrajectory(json: string): ATIFTrajectory {
	return JSON.parse(json) as ATIFTrajectory
}
