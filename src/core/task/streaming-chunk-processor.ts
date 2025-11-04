import type { Anthropic } from "@anthropic-ai/sdk"
import type { ApiStream, ApiStreamChunk, ApiStreamUsageChunk } from "@core/api/transform/stream"
import type { AssistantMessageContent } from "@core/assistant-message"
import { parseAssistantMessageV2 } from "@core/assistant-message"
import type { ClineApiReqCancelReason, ClineSay } from "@shared/ExtensionMessage"
import { CLINE_MCP_TOOL_IDENTIFIER } from "@shared/mcp"
import { ClineDefaultTool } from "@shared/tools"
import { ToolUseHandler } from "@/core/api/transform/tool-use-handler"
import type { TaskState } from "./TaskState"

export type StreamingChunkState = {
	// For UI display (includes XML)
	assistantMessage: string
	// For API history (text only, no tool XML)
	assistantTextOnly: string
	reasoningMessage: string
	reasoningDetails: Array<unknown>
	antThinkingContent: Array<Anthropic.Messages.RedactedThinkingBlock | Anthropic.Messages.ThinkingBlock>
}

export type TokenUsageSnapshot = {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost?: number
}

type SayFn = (
	type: ClineSay,
	text?: string,
	images?: string[],
	files?: string[],
	partial?: boolean,
) => Promise<number | undefined>

type AbortStreamHandler = (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => Promise<void>

type StreamingChunkProcessorOptions = {
	taskState: TaskState
	say: SayFn
	presentAssistantMessage: () => void
	useNativeToolCalls: boolean
	abortStream: AbortStreamHandler
	streamingState: StreamingChunkState
}

export type StreamingChunkProcessingResult = {
	didReceiveUsageChunk: boolean
}

export class StreamingChunkProcessor {
	private readonly taskState: TaskState
	private readonly toolUseHandler: ToolUseHandler
	private readonly say: SayFn
	private readonly presentAssistantMessage: () => void
	private readonly useNativeToolCalls: boolean
	private readonly abortStream: AbortStreamHandler
	private readonly streamingState: StreamingChunkState

	private shouldStopStreaming = false
	private didReceiveUsageChunk = false

	private inputTokens = 0
	private outputTokens = 0
	private cacheWriteTokens = 0
	private cacheReadTokens = 0
	private totalCost: number | undefined

	constructor(options: StreamingChunkProcessorOptions) {
		this.taskState = options.taskState
		this.toolUseHandler = new ToolUseHandler()
		this.say = options.say
		this.presentAssistantMessage = options.presentAssistantMessage
		this.useNativeToolCalls = options.useNativeToolCalls
		this.abortStream = options.abortStream
		this.streamingState = options.streamingState
	}

	public async processStream(stream: ApiStream): Promise<StreamingChunkProcessingResult> {
		for await (const chunk of stream) {
			if (!chunk) {
				continue
			}

			await this.handleChunk(chunk)

			if (this.shouldStopStreaming) {
				break
			}
		}

		// Finalize any remaining tool calls at the end of the stream
		this.finalizeNativeToolCalls()

		return {
			didReceiveUsageChunk: this.didReceiveUsageChunk,
		}
	}

	public getUsageSnapshot(): TokenUsageSnapshot {
		return {
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
			cacheWriteTokens: this.cacheWriteTokens,
			cacheReadTokens: this.cacheReadTokens,
			totalCost: this.totalCost,
		}
	}

	private updateTokenUsage(usage: ApiStreamUsageChunk): void {
		this.inputTokens += usage.inputTokens
		this.outputTokens += usage.outputTokens
		this.cacheWriteTokens += usage.cacheWriteTokens ?? 0
		this.cacheReadTokens += usage.cacheReadTokens ?? 0
		this.totalCost = usage.totalCost
	}

	async handleChunk(chunk: ApiStreamChunk): Promise<void> {
		switch (chunk.type) {
			case "usage":
				this.didReceiveUsageChunk = true
				this.updateTokenUsage(chunk)
				break
			case "reasoning":
			case "reasoning_details":
			case "ant_thinking":
			case "ant_redacted_thinking":
				await this.handleReasoningChunk(chunk)
				break
			case "tool_calls":
				this.handleToolCallChunk(chunk)
				break
			case "text":
				await this.handleTextChunk(chunk)
				break
		}

		await this.handlePostChunkActions()
	}

	private async handleReasoningChunk(
		chunk: Extract<ApiStreamChunk, { type: "reasoning" | "reasoning_details" | "ant_thinking" | "ant_redacted_thinking" }>,
	): Promise<void> {
		switch (chunk.type) {
			case "reasoning":
				// reasoning will always come before assistant message
				this.streamingState.reasoningMessage += chunk.reasoning
				// fixes bug where cancelling task > aborts task > for loop may be in middle of streaming reasoning > say function throws error before we get a chance to properly clean up and cancel the task.
				if (!this.taskState.abort) {
					await this.say("reasoning", this.streamingState.reasoningMessage, undefined, undefined, true)
				}
				break
			// for cline/openrouter providers
			case "reasoning_details":
				// reasoning_details may be an array of 0 or 1 items depending on how openrouter returns it
				const details = Array.isArray(chunk.reasoning_details) ? chunk.reasoning_details : [chunk.reasoning_details]
				this.streamingState.reasoningDetails = [...this.streamingState.reasoningDetails, ...details]
				break
			// for anthropic providers
			case "ant_thinking":
				this.streamingState.antThinkingContent.push({
					type: "thinking",
					thinking: chunk.thinking,
					signature: chunk.signature,
				})
				break
			case "ant_redacted_thinking":
				this.streamingState.antThinkingContent.push({
					type: "redacted_thinking",
					data: chunk.data,
				})
				break
		}
	}

	private handleToolCallChunk(chunk: Extract<ApiStreamChunk, { type: "tool_calls" }>): void {
		if (!chunk.tool_call) {
			console.log("no tool call in chunk, skipping...", chunk)
			return
		}

		// Accumulate tool use blocks in proper Anthropic format
		this.toolUseHandler.processToolUseDelta({
			id: chunk.tool_call.function?.id,
			type: "tool_use",
			name: chunk.tool_call.function?.name,
			input: chunk.tool_call.function?.arguments,
		})

		// Extract and store tool_use_id for creating proper ToolResultBlockParam
		if (chunk.tool_call.function?.id && chunk.tool_call.function?.name) {
			this.taskState.toolUseIdMap.set(chunk.tool_call.function.name, chunk.tool_call.function.id)

			// For MCP tools, also store the mapping with the transformed name
			// since getPartialToolUsesAsContent() will transform the name to "use_mcp_tool"
			if (chunk.tool_call.function.name.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
				this.taskState.toolUseIdMap.set(ClineDefaultTool.MCP_USE, chunk.tool_call.function.id)
			}
		}

		const { textBlocks, toolBlocks, prevLength } = this.getUserMessageContent()

		// Combine any text content with tool uses
		this.streamingState.assistantMessage += toolBlocks.map((block) => JSON.stringify(block)).join("\n")
		this.taskState.assistantMessageContent = [...textBlocks, ...toolBlocks]

		if (this.taskState.assistantMessageContent.length > prevLength) {
			this.taskState.userMessageContentReady = false
		}
		this.presentAssistantMessage()
	}

	private async handleTextChunk(chunk: Extract<ApiStreamChunk, { type: "text" }>): Promise<void> {
		if (this.streamingState.reasoningMessage && this.streamingState.assistantMessage.length === 0) {
			await this.say("reasoning", this.streamingState.reasoningMessage, undefined, undefined, false)
		}

		this.streamingState.assistantMessage += chunk.text
		this.streamingState.assistantTextOnly += chunk.text

		const { prevLength } = this.getUserMessageContent()

		this.taskState.assistantMessageContent = parseAssistantMessageV2(this.streamingState.assistantMessage)

		if (this.taskState.assistantMessageContent.length > prevLength) {
			this.taskState.userMessageContentReady = false
		}

		this.presentAssistantMessage()
	}

	private async handlePostChunkActions(): Promise<void> {
		if (this.taskState.abort) {
			console.log("aborting stream...")
			if (!this.taskState.abandoned) {
				// only need to gracefully abort if this instance isn't abandoned (sometimes openrouter stream hangs, in which case this would affect future instances of cline)
				await this.abortStream("user_cancelled")
			}
			this.shouldStopStreaming = true
			return // aborts the stream
		}

		if (this.taskState.didRejectTool) {
			// userContent has a tool rejection, so interrupt the assistant's response to present the user's feedback
			this.streamingState.assistantMessage += "\n\n[Response interrupted by user feedback]"
			this.shouldStopStreaming = true
			return
		}
		// PREV: we need to let the request finish for openrouter to get generation details
		// UPDATE: it's better UX to interrupt the request at the cost of the api cost not being retrieved
		if (this.taskState.didAlreadyUseTool) {
			this.streamingState.assistantMessage +=
				"\n\n[Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.]"
			this.shouldStopStreaming = true
		}
	}

	private finalizeNativeToolCalls(): void {
		if (!this.useNativeToolCalls) {
			return
		}

		// For native tool calls, mark all pending tool uses as complete
		const { textBlocks, toolBlocks, prevLength } = this.getUserMessageContent()
		// Get all finalized tool uses and mark as complete
		const finalizedToolBlocks = toolBlocks.map((block) => ({ ...block, partial: false }))

		this.taskState.assistantMessageContent = [...textBlocks, ...finalizedToolBlocks]

		if (this.taskState.assistantMessageContent.length > prevLength) {
			this.taskState.userMessageContentReady = false
		}
		this.presentAssistantMessage()
	}

	get didReceiveUsage(): boolean {
		return this.didReceiveUsageChunk
	}

	private getUserMessageContent() {
		const prevLength = this.taskState.assistantMessageContent.length
		const textContent = this.streamingState.assistantTextOnly.trim()
		const textBlocks: AssistantMessageContent[] = textContent ? [{ type: "text", content: textContent, partial: false }] : []
		const toolBlocks = this.toolUseHandler.getPartialToolUsesAsContent()

		return { textBlocks, toolBlocks, prevLength }
	}

	public getFinalizedToolCalls() {
		return this.toolUseHandler.getAllFinalizedToolUses()
	}
}
