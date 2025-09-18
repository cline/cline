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
import { ApiStream } from "../transform/stream"

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
		// Add system/developer instructions first
		if (systemPrompt && systemPrompt.length > 0) {
			inputItems.push({ role: roleForSystem, content: [{ type: "input_text", text: systemPrompt }] })
		}

		for (const m of messages) {
			if (typeof m.content === "string") {
				inputItems.push({ role: m.role as any, content: [{ type: "input_text", text: m.content }] })
				continue
			}

			const content: ResponseInputMessageContentList = []
			for (const part of m.content) {
				if (part.type === "text") {
					content.push({ type: "input_text", text: part.text })
				} else if (part.type === "image") {
					// Map Anthropic image block -> Responses input_image with data URL
					content.push({
						type: "input_image",
						detail: "auto",
						image_url: `data:${part.source.media_type};base64,${part.source.data}`,
					})
				} else if (part.type === "tool_result") {
				} else if (part.type === "tool_use") {
				}
			}

			// If no supported content was found, skip adding this message
			if (content.length > 0) {
				const role =
					m.role === "assistant" || m.role === "user" || m.role === "system" || m.role === "developer"
						? (m.role as "assistant" | "user" | "system" | "developer")
						: (m.role as any)
				inputItems.push({ role, content })
			}
		}

		return inputItems
	}

	private escapeXml(value: string): string {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;")
	}

	private formatFunctionCallXml(name: string, argumentJson: string): string {
		let parsedArgs: Record<string, unknown> | undefined
		if (argumentJson && argumentJson.trim().length > 0) {
			try {
				const maybeParsed = JSON.parse(argumentJson)
				if (maybeParsed && typeof maybeParsed === "object") {
					parsedArgs = maybeParsed as Record<string, unknown>
				}
			} catch (error) {
				console.error("Failed to parse function call arguments:", error)
			}
		}

		let xml = `<${name}>`
		if (parsedArgs) {
			for (const [key, rawValue] of Object.entries(parsedArgs)) {
				const stringValue =
					rawValue === null || rawValue === undefined
						? ""
						: typeof rawValue === "string"
							? rawValue
							: JSON.stringify(rawValue)
				xml += `<${key}>${this.escapeXml(stringValue)}</${key}>`
			}
		} else if (argumentJson && argumentJson.trim().length > 0) {
			xml += `<arguments>${this.escapeXml(argumentJson)}</arguments>`
		}
		xml += `</${name}>`
		return xml
	}

	private *iterateResponseOutputText(output: any[] | undefined): Generator<string> {
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
						yield content.text
					}
				}
			} else if (item.type === "function_call") {
				const functionCall = item as ResponseFunctionToolCallItem
				const xml = this.formatFunctionCallXml(functionCall.name, functionCall.arguments || "")
				if (xml.length > 0) {
					yield xml
				}
			}
		}
	}

	private async *streamResponse(stream: AsyncIterable<ResponseStreamEvent>, modelInfo: ModelInfo): ApiStream {
		const pendingFunctionCalls = new Map<string, { name: string; arguments: string }>()
		for await (const event of stream) {
			switch (event.type) {
				case "response.output_item.added": {
					const added = event as ResponseOutputItemAddedEvent
					if (added.item.type === "function_call") {
						const functionCall = added.item as ResponseFunctionToolCallItem
						pendingFunctionCalls.set(functionCall.id, { name: functionCall.name, arguments: "" })
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
					const xml = this.formatFunctionCallXml(functionName, args)
					if (xml.length > 0) {
						yield { type: "text", text: xml }
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
				})
				let emittedText = false
				for (const chunk of this.iterateResponseOutputText((resp as any)?.output)) {
					emittedText = true
					yield { type: "text", text: chunk }
				}
				if (!emittedText) {
					const fallbackText = resp.output_text || ""
					if (fallbackText.length > 0) {
						yield { type: "text", text: fallbackText }
					}
				}
				if ((resp as any).usage) {
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
