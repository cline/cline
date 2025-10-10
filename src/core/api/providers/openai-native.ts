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

const DEBUG_TOOLCALLS = process.env.CLINE_EVALS_DEBUG === "1" || process.env.CLINE_DEBUG_TOOLCALLS === "1"

function extractReasoningText(payload: unknown): string {
	if (!payload) {
		return ""
	}
	if (typeof payload === "string") {
		return payload
	}
	if (Array.isArray(payload)) {
		return payload
			.map((entry) => extractReasoningText(entry))
			.filter((part) => part && part.length > 0)
			.join("")
	}
	if (typeof payload === "object") {
		const obj = payload as Record<string, unknown>
		if (typeof obj.text === "string") {
			return obj.text
		}
		if (Array.isArray(obj.content)) {
			return extractReasoningText(obj.content)
		}
		if (obj.delta) {
			return extractReasoningText(obj.delta)
		}
		if (obj.reasoning) {
			return extractReasoningText(obj.reasoning)
		}
		if (typeof obj.analysis === "string") {
			return obj.analysis
		}
		let combined = ""
		for (const value of Object.values(obj)) {
			const part = extractReasoningText(value)
			if (part) {
				combined += part
			}
		}
		return combined
	}
	return ""
}

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
			const assistantTextParts: string[] = []
			const flushMessage = () => {
				if (messageContent.length > 0) {
					inputItems.push({ role: m.role as any, content: [...messageContent] })
					messageContent.length = 0
				}
			}

			for (const part of m.content) {
				switch (part.type) {
					case "text":
						if (m.role === "assistant") {
							assistantTextParts.push(part.text)
						} else {
							messageContent.push({ type: "input_text", text: part.text })
						}
						break
					case "image":
						if (m.role === "assistant") {
							assistantTextParts.push(`[image:${part.source.media_type}]`)
						} else {
							messageContent.push({
								type: "input_image",
								detail: "auto",
								image_url: `data:${part.source.media_type};base64,${part.source.data}`,
							})
						}
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
						const fallbackSuffix = syntheticCallCounter++
						const explicitCallId = typeof (part as any).call_id === "string" ? (part as any).call_id : undefined
						const functionId = typeof part.id === "string" && part.id.length > 0 ? part.id : `fc_${fallbackSuffix}`
						const callId =
							explicitCallId && explicitCallId.length > 0
								? explicitCallId
								: functionId.startsWith("fc_")
									? `call_${functionId.slice(3)}`
									: `call_${fallbackSuffix}`
						inputItems.push({
							type: "function_call",
							id: functionId,
							call_id: callId,
							name: part.name,
							arguments: JSON.stringify(part.input ?? {}),
						} as any)
						break
					}
				}
			}

			flushMessage()
			if (m.role === "assistant" && assistantTextParts.length > 0) {
				const outputParts = assistantTextParts
					.filter((text) => typeof text === "string" && text.length > 0)
					.map((text) => ({ type: "output_text", text }))
				if (outputParts.length > 0) {
					inputItems.push({
						type: "message",
						role: "assistant",
						content: outputParts,
					} as any)
				}
			}
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

	private normalizeToolArgumentValue(value: unknown): unknown {
		if (value === null || value === undefined) {
			return ""
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.normalizeToolArgumentValue(item))
		}
		if (typeof value === "object") {
			const record = value as Record<string, unknown>
			if (record.value !== undefined) {
				return this.normalizeToolArgumentValue(record.value)
			}
			if (record.text !== undefined) {
				return this.normalizeToolArgumentValue(record.text)
			}
		}
		return value
	}

	private normalizeToolArguments(input: unknown): { args: Record<string, unknown>; raw: string } {
		let parsed: unknown = input
		let raw = "{}"

		if (typeof input === "string") {
			raw = input
			try {
				parsed = JSON.parse(input)
			} catch {
				return { args: {}, raw: input }
			}
		} else if (input !== undefined) {
			try {
				raw = JSON.stringify(input)
			} catch {
				raw = "{}"
			}
		}

		const args: Record<string, unknown> = {}

		const assign = (key: string, value: unknown) => {
			if (!key) {
				return
			}
			args[key] = this.normalizeToolArgumentValue(value)
		}

		if (Array.isArray(parsed)) {
			parsed.forEach((item, index) => {
				if (item && typeof item === "object") {
					const entry = item as Record<string, unknown>
					const name = typeof entry.name === "string" ? entry.name : String(index)
					const value = entry.value ?? entry.text ?? entry.argument ?? item
					assign(name, value)
				} else {
					assign(String(index), item)
				}
			})
		} else if (parsed && typeof parsed === "object") {
			for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (key === "tool_name" || key === "toolName" || key === "arguments") {
					continue
				}
				assign(key, value)
			}
		} else {
			const normalized = this.normalizeToolArgumentValue(parsed)
			if (typeof normalized === "string" && normalized.length > 0) {
				return { args: {}, raw: normalized }
			}
			return { args: {}, raw }
		}

		try {
			raw = JSON.stringify(args)
		} catch {
			raw = "{}"
		}
		if (raw === "{}" && typeof parsed === "string") {
			const trimmed = (parsed as string).trim()
			if (trimmed.length > 0) {
				raw = trimmed
			}
		}

		return { args, raw }
	}

	private sanitizeToolArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
		if (!args) {
			return args
		}
		const sanitized: Record<string, unknown> = { ...args }
		const pathLikeKeys = new Set(["path", "rel_path", "new_path", "target_path", "file_path", "dir_path", "uri"])
		const terminationTokens = [
			"','",
			"' ,",
			"', ",
			"';",
			"'; ",
			"\n",
			"\r",
			'"',
			" does not exist",
			" actual path is",
			" File not found",
			',"task_progress":',
		]

		const decodeEntities = (value: string): string =>
			value
				.replace(/&quot;/g, '"')
				.replace(/&#34;/g, '"')
				.replace(/&#39;/g, "'")
				.replace(/&apos;/g, "'")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")

		const cleanString = (value: string, isPathLike: boolean): string => {
			let result = decodeEntities(value).trim()
			result = result.replace(/^['"`]+/, "")
			if (isPathLike) {
				for (const token of terminationTokens) {
					const idx = result.indexOf(token)
					if (idx !== -1) {
						result = result.slice(0, idx)
						break
					}
				}
			}
			result = result.trim().replace(/['"`]+$/, "")
			return result
		}

		for (const [key, value] of Object.entries(sanitized)) {
			if (typeof value === "string") {
				const isPathLike =
					pathLikeKeys.has(key) || key.toLowerCase().includes("path") || key.toLowerCase().includes("uri")
				sanitized[key] = cleanString(value, isPathLike)
			} else if (Array.isArray(value)) {
				const coerced = value.map((entry) => {
					if (typeof entry === "string") {
						const isPathLike = key.toLowerCase().includes("path") || key.toLowerCase().includes("uri")
						return cleanString(entry, isPathLike)
					}
					return entry
				})
				sanitized[key] = coerced
			}
		}

		if (toolName === "read_file" && typeof sanitized.path === "string") {
			return sanitized
		}

		return sanitized
	}

	private *iterateResponseOutput(output: any[] | undefined, reasoningCollector?: string[]): Generator<ApiStreamChunk> {
		let toolCallCount = 0
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
				const baseArgs = this.normalizeToolArguments(parsedArguments)
				let toolName = functionCall.name
				let toolArgs = baseArgs.args
				let toolRawArgs = baseArgs.raw === "{}" && rawArguments ? rawArguments : baseArgs.raw
				if (!toolRawArgs || toolRawArgs.length === 0) {
					toolRawArgs = rawArguments
				}
				if (functionCall.name === "call_tool") {
					const maybeToolName = (parsedArguments as any)?.tool_name || (parsedArguments as any)?.toolName
					const maybeArgs = (parsedArguments as any)?.arguments
					if (typeof maybeToolName === "string" && maybeToolName.length > 0) {
						toolName = maybeToolName
					}
					const normalizedCallArgs = this.normalizeToolArguments(maybeArgs)
					if (Object.keys(normalizedCallArgs.args).length > 0) {
						toolArgs = normalizedCallArgs.args
						toolRawArgs = normalizedCallArgs.raw
					} else if (typeof maybeArgs === "string" && maybeArgs.trim().length > 0) {
						toolRawArgs = maybeArgs
						toolArgs = {}
					} else {
						toolArgs = {}
						toolRawArgs = "{}"
					}
				}
				toolArgs = this.sanitizeToolArguments(toolName, toolArgs)
				try {
					toolRawArgs = JSON.stringify(toolArgs)
				} catch {
					// ignore and keep previous raw string
				}
				yield {
					type: "tool_call",
					callId: functionCall.call_id || functionCall.id,
					name: toolName,
					arguments: toolArgs,
					rawArguments: toolRawArgs,
				}
				if (DEBUG_TOOLCALLS && toolName !== "replace_in_file") {
					try {
						console.warn("[OpenAI Responses][debug] iterateResponseOutput: non-replace_in_file", { name: toolName })
					} catch {}
				}
				toolCallCount++
			} else if (item.type === "reasoning") {
				const reasoningText = extractReasoningText((item as any)?.reasoning ?? (item as any)?.content ?? item)
				if (reasoningText) {
					reasoningCollector?.push(reasoningText)
					yield { type: "reasoning", reasoning: reasoningText }
				}
			}
		}
		if (DEBUG_TOOLCALLS && toolCallCount === 0) {
			try {
				console.warn("[OpenAI Responses][debug] iterateResponseOutput: no tool calls detected in final output array")
			} catch {}
		}
	}

	private async *streamResponse(stream: AsyncIterable<ResponseStreamEvent>, modelInfo: ModelInfo): ApiStream {
		const pendingFunctionCalls = new Map<string, { name: string; callId: string; arguments: string }>()
		let toolCallCount = 0
		let textPreview = ""
		let reasoningBuffer = ""
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
					const baseArgs = this.normalizeToolArguments(parsedArguments)
					let toolName = functionName
					let toolArgs = baseArgs.args
					let toolRawArgs = baseArgs.raw === "{}" && args ? args : baseArgs.raw
					if (!toolRawArgs || toolRawArgs.length === 0) {
						toolRawArgs = args
					}
					if (functionName === "call_tool") {
						const maybeToolName = (parsedArguments as any)?.tool_name || (parsedArguments as any)?.toolName
						const maybeArgs = (parsedArguments as any)?.arguments
						if (typeof maybeToolName === "string" && maybeToolName.length > 0) {
							toolName = maybeToolName
						}
						const normalizedCallArgs = this.normalizeToolArguments(maybeArgs)
						if (Object.keys(normalizedCallArgs.args).length > 0) {
							toolArgs = normalizedCallArgs.args
							toolRawArgs = normalizedCallArgs.raw
						} else if (typeof maybeArgs === "string" && maybeArgs.trim().length > 0) {
							toolRawArgs = maybeArgs
							toolArgs = {}
						} else {
							toolArgs = {}
							toolRawArgs = "{}"
						}
					}
					toolArgs = this.sanitizeToolArguments(toolName, toolArgs)
					try {
						toolRawArgs = JSON.stringify(toolArgs)
					} catch {
						// keep previous raw string
					}
					yield {
						type: "tool_call",
						callId: pending?.callId || doneEvent.item_id,
						name: toolName,
						arguments: toolArgs,
						rawArguments: toolRawArgs,
					}
					if (DEBUG_TOOLCALLS && toolName !== "replace_in_file") {
						try {
							console.warn("[OpenAI Responses][debug] stream: non-replace_in_file", { name: toolName })
						} catch {}
					}
					toolCallCount++
					pendingFunctionCalls.delete(doneEvent.item_id)
					break
				}
				case "response.output_text.delta": {
					const deltaText = (event as ResponseTextDeltaEvent).delta
					yield { type: "text", text: deltaText }
					if (DEBUG_TOOLCALLS && textPreview.length < 600) {
						textPreview += deltaText
						if (textPreview.length > 600) {
							textPreview = textPreview.slice(0, 600)
						}
					}
					break
				}
				case "response.completed": {
					const completed = event as ResponseCompletedEvent
					if (completed.response?.usage) {
						yield* this.yieldUsage(modelInfo, completed.response.usage)
					}
					if (DEBUG_TOOLCALLS && toolCallCount === 0) {
						try {
							console.warn("[OpenAI Responses][debug] Stream completed with no tool calls", {
								model: (modelInfo as any)?.id,
								textPreview: textPreview.slice(0, 300),
							})
						} catch {}
					}
					if (DEBUG_TOOLCALLS && reasoningBuffer.length === 0) {
						const responseReasoning = extractReasoningText((completed.response as any)?.reasoning)
						if (responseReasoning) {
							reasoningBuffer += responseReasoning
							yield { type: "reasoning", reasoning: responseReasoning }
						}
					}
					if (DEBUG_TOOLCALLS && reasoningBuffer.length > 0) {
						try {
							console.warn("[OpenAI Responses][debug] reasoning summary", reasoningBuffer.slice(0, 600))
						} catch {}
					}
					break
				}
				default: {
					const eventType = (event as any)?.type
					if (eventType === "response.reasoning.delta") {
						const deltaText = extractReasoningText((event as any)?.delta ?? event)
						if (deltaText) {
							reasoningBuffer += deltaText
							yield { type: "reasoning", reasoning: deltaText }
						}
					} else if (eventType === "response.reasoning.completed") {
						const completedReasoning = extractReasoningText((event as any)?.reasoning ?? event)
						if (completedReasoning) {
							reasoningBuffer += completedReasoning
							yield { type: "reasoning", reasoning: completedReasoning }
						}
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
					store: true,
					include: ["reasoning.encrypted_content"],
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
					parallel_tool_calls: false,
				})
				let emittedContent = false
				const reasoningSegments: string[] = []
				for (const chunk of this.iterateResponseOutput((resp as any)?.output, reasoningSegments)) {
					emittedContent = true
					yield chunk
				}
				if (DEBUG_TOOLCALLS) {
					const reasoningSummary = reasoningSegments.join("") || extractReasoningText((resp as any)?.reasoning)
					if (reasoningSummary && reasoningSummary.length > 0) {
						try {
							console.warn("[OpenAI Responses][debug] reasoning summary", reasoningSummary.slice(0, 600))
						} catch {}
					}
				}
				if (DEBUG_TOOLCALLS) {
					try {
						const outputArray = ((resp as any)?.output || []) as any[]
						const fnCalls = outputArray.filter((it) => it?.type === "function_call").length
						if (fnCalls === 0) {
							console.warn("[OpenAI Responses][debug] Non-streaming response had no function_call items", {
								model: model.id,
								outputTextPreview: (resp as any)?.output_text?.slice?.(0, 300) || "",
							})
						}
					} catch {}
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
					store: true,
					stream: true,
					include: ["reasoning.encrypted_content"],
					reasoning: { effort: (this.options.reasoningEffort as any) || "medium" },
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
					parallel_tool_calls: false,
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
					store: true,
					stream: true,
					include: ["reasoning.encrypted_content"],
					temperature: 1,
					reasoning: { effort: (this.options.reasoningEffort as any) || "medium" },
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
					parallel_tool_calls: false,
				})) as any
				yield* this.streamResponse(stream as AsyncIterable<ResponseStreamEvent>, model.info)
				break
			}
			default: {
				const input = this.convertAnthropicToResponsesInput(systemPrompt, messages, "system")
				const stream = (await client.responses.create({
					model: model.id,
					input,
					store: true,
					stream: true,
					include: ["reasoning.encrypted_content"],
					temperature: 0,
					tools: getOpenAiResponsesTools(),
					tool_choice: "auto",
					parallel_tool_calls: false,
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

	buildResponsesCreateParams(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): {
		client: OpenAI
		params: Parameters<OpenAI["responses"]["create"]>[0]
		modelInfo: ModelInfo
	} {
		const client = this.ensureClient()
		const model = this.getModel()
		const useDeveloperRole = model.id.startsWith("gpt-5")
		const input = this.convertAnthropicToResponsesInput(systemPrompt, messages, useDeveloperRole ? "developer" : "system")
		const params: Parameters<OpenAI["responses"]["create"]>[0] = {
			model: model.id,
			input,
			store: true,
			include: ["reasoning.encrypted_content"],
			tool_choice: "auto",
			tools: getOpenAiResponsesTools(),
			parallel_tool_calls: false,
		}
		if (model.id.startsWith("gpt-5")) {
			params.reasoning = { effort: (this.options.reasoningEffort as any) || "medium" }
			params.temperature = 1
		} else {
			params.temperature = 0
		}
		return { client, params, modelInfo: model.info }
	}
}
