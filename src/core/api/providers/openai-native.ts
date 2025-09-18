import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, OpenAiNativeModelId, openAiNativeDefaultModelId, openAiNativeModels } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type {
	ResponseCompletedEvent,
	ResponseFunctionCallArgumentsDeltaEvent,
	ResponseFunctionCallArgumentsDoneEvent,
	ResponseFunctionToolCallItem,
	ResponseInput,
	ResponseInputMessageContentList,
	ResponseOutputItemAddedEvent,
	ResponseStreamEvent,
	ResponseTextDeltaEvent,
} from "openai/resources/responses/responses"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { ApiStream, ApiStreamChunk } from "../transform/stream"
import { getOpenAiResponsesTools } from "./openai-native-tools"

interface OpenAiNativeHandlerOptions extends CommonApiHandlerOptions {
	openAiNativeApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class OpenAiNativeHandler implements ApiHandler {
	private options: OpenAiNativeHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiNativeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiNativeApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				this.client = new OpenAI({
					apiKey: this.options.openAiNativeApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(
		info: ModelInfo,
		usage: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined,
	): ApiStream {
		const inputTokens = usage?.input_tokens || 0
		const outputTokens = usage?.output_tokens || 0
		const cacheReadTokens = usage?.input_tokens_details?.cached_tokens || 0
		const cacheWriteTokens = 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
		const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
		yield {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	private convertAnthropicToResponsesInput(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		roleForSystem: "system" | "developer" = "system",
	): ResponseInput {
		const inputItems: ResponseInput = []
		if (systemPrompt && systemPrompt.length > 0) {
			inputItems.push({ role: roleForSystem, content: [{ type: "input_text", text: systemPrompt }] })
		}

		let syntheticCallCounter = 0

		for (const m of messages) {
			if (typeof m.content === "string") {
				inputItems.push({ role: m.role as any, content: [{ type: "input_text", text: m.content }] })
				continue
			}

			const messageContent: ResponseInputMessageContentList = []
			const flushMessage = () => {
				if (messageContent.length > 0) {
					inputItems.push({ role: m.role as any, content: [...messageContent] })
					messageContent.length = 0
				}
			}

			for (const part of m.content) {
				switch (part.type) {
					case "text":
						messageContent.push({ type: "input_text", text: part.text })
						break
					case "image":
						messageContent.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${part.source.media_type};base64,${part.source.data}`,
						})
						break
					case "tool_result": {
						flushMessage()
						const callId = part.tool_use_id || `tool_call_${syntheticCallCounter++}`
						inputItems.push({
							type: "function_call_output",
							call_id: callId,
							output: this.serializeToolResultContent(part.content),
						} as any)
						break
					}
					case "tool_use": {
						flushMessage()
						const callId = part.id || `tool_call_${syntheticCallCounter++}`
						inputItems.push({
							type: "function_call",
							id: part.id,
							call_id: callId,
							name: part.name,
							arguments: JSON.stringify(part.input ?? {}),
						} as any)
						break
					}
				}
			}

			flushMessage()
		}

		return inputItems
	}

	private serializeToolResultContent(
		content: Anthropic.Messages.ToolResultBlockParam["content"] | string | null | undefined,
	): string {
		if (!content) {
			return ""
		}
		if (typeof content === "string") {
			return content
		}
		if (Array.isArray(content)) {
			return content
				.map((part) => {
					if (!part) {
						return ""
					}
					if (typeof part === "string") {
						return part
					}
					if (part.type === "text") {
						return part.text ?? ""
					}
					if (part.type === "image") {
						return `[image:${part.source?.media_type ?? "unknown"}]`
					}
					return JSON.stringify(part)
				})
				.filter(Boolean)
				.join("\n")
		}
		return JSON.stringify(content)
	}

	private *iterateResponseOutput(output: any[] | undefined): Generator<ApiStreamChunk> {
		if (!output) {
			return
		}
		for (const item of output) {
			if (!item) {
				continue
			}
			if (item.type === "message") {
				for (const content of item.content ?? []) {
					if (content?.type === "output_text" && content.text) {
						yield { type: "text", text: content.text }
					}
				}
			} else if (item.type === "function_call") {
				const functionCall = item as ResponseFunctionToolCallItem
				const rawArguments = functionCall.arguments || ""
				let parsedArguments: Record<string, unknown> = {}
				if (rawArguments) {
					try {
						parsedArguments = JSON.parse(rawArguments)
					} catch (error) {
						console.error("Failed to parse function call arguments:", error)
						parsedArguments = {}
					}
				}
				yield {
					type: "tool_call",
					callId: functionCall.call_id || functionCall.id,
					name: functionCall.name,
					arguments: parsedArguments,
					rawArguments,
				}
			}
		}
	}

	private async *streamResponse(stream: AsyncIterable<ResponseStreamEvent>, modelInfo: ModelInfo): ApiStream {
		const pendingFunctionCalls = new Map<string, { name: string; callId: string; arguments: string }>()
		for await (const event of stream) {
			switch (event.type) {
				case "response.output_item.added": {
					const added = event as ResponseOutputItemAddedEvent
					if (added.item.type === "function_call") {
						const functionCall = added.item as ResponseFunctionToolCallItem
						pendingFunctionCalls.set(functionCall.id, {
							name: functionCall.name,
							callId: functionCall.call_id || functionCall.id,
							arguments: "",
						})
					}
					break
				}
				case "response.function_call_arguments.delta": {
					const deltaEvent = event as ResponseFunctionCallArgumentsDeltaEvent
					const pending = pendingFunctionCalls.get(deltaEvent.item_id)
					if (pending) {
						pending.arguments += deltaEvent.delta
					}
					break
				}
				case "response.function_call_arguments.done": {
					const doneEvent = event as ResponseFunctionCallArgumentsDoneEvent
					const pending = pendingFunctionCalls.get(doneEvent.item_id)
					const functionName = pending?.name || "function_call"
					const args = doneEvent.arguments || pending?.arguments || ""
					let parsedArguments: Record<string, unknown> = {}
					if (args) {
						try {
							parsedArguments = JSON.parse(args)
						} catch (error) {
							console.error("Failed to parse function call arguments:", error)
							parsedArguments = {}
						}
					}
					yield {
						type: "tool_call",
						callId: pending?.callId || doneEvent.item_id,
						name: functionName,
						arguments: parsedArguments,
						rawArguments: args,
					}
					pendingFunctionCalls.delete(doneEvent.item_id)
					break
				}
				case "response.output_text.delta": {
					yield { type: "text", text: (event as ResponseTextDeltaEvent).delta }
					break
				}
				case "response.completed": {
					const completed = event as ResponseCompletedEvent
					if (completed.response?.usage) {
						yield* this.yieldUsage(modelInfo, completed.response.usage)
					}
					break
				}
			}
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		// Build Responses input for the request per model family
		switch (model.id) {
			case "o1":
			case "o1-preview":
			case "o1-mini": {
				// Non-streaming; o1 ignores system role, pass as user content
				const input = this.convertAnthropicToResponsesInput("", [{ role: "user", content: systemPrompt }, ...messages])
				const resp = await client.responses.create({
					model: model.id,
					input,
					store: false,
					include: ["reasoning.encrypted_content"],
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
				})
				let emittedContent = false
				for (const chunk of this.iterateResponseOutput((resp as any)?.output)) {
					emittedContent = true
					yield chunk
				}
				if (!emittedContent) {
					const fallbackText = resp.output_text || ""
					if (fallbackText.length > 0) {
						yield { type: "text", text: fallbackText }
					}
				}
				if ((resp as any)?.usage) {
					yield* this.yieldUsage(model.info, (resp as any).usage)
				}
				break
			}
			case "o4-mini":
			case "o3":
			case "o3-mini": {
				const input = this.convertAnthropicToResponsesInput(systemPrompt, messages, "developer")
				const stream = (await client.responses.create({
					model: model.id,
					input,
					store: false,
					stream: true,
					include: ["reasoning.encrypted_content"],
					reasoning: { effort: (this.options.reasoningEffort as any) || "medium" },
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
				})) as any
				yield* this.streamResponse(stream as AsyncIterable<ResponseStreamEvent>, model.info)
				break
			}
			case "gpt-5-2025-08-07":
			case "gpt-5-mini-2025-08-07":
			case "gpt-5-nano-2025-08-07": {
				const input = this.convertAnthropicToResponsesInput(systemPrompt, messages, "developer")
				const stream = (await client.responses.create({
					model: model.id,
					input,
					store: false,
					stream: true,
					include: ["reasoning.encrypted_content"],
					temperature: 1,
					reasoning: { effort: (this.options.reasoningEffort as any) || "medium" },
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
				})) as any
				yield* this.streamResponse(stream as AsyncIterable<ResponseStreamEvent>, model.info)
				break
			}
			default: {
				const input = this.convertAnthropicToResponsesInput(systemPrompt, messages, "system")
				const stream = (await client.responses.create({
					model: model.id,
					input,
					store: false,
					stream: true,
					include: ["reasoning.encrypted_content"],
					temperature: 0,
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
				})) as any
				yield* this.streamResponse(stream as AsyncIterable<ResponseStreamEvent>, model.info)
			}
		}
	}

	getModel(): { id: OpenAiNativeModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			return { id, info: openAiNativeModels[id] }
		}
		return {
			id: openAiNativeDefaultModelId,
			info: openAiNativeModels[openAiNativeDefaultModelId],
		}
	}
}
