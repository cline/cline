import {
	ModelInfo,
	OpenAiCompatibleModelInfo,
	OpenAiNativeModelId,
	openAiNativeDefaultModelId,
	openAiNativeModels,
} from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type {
	ChatCompletionFunctionTool,
	ChatCompletionReasoningEffort,
	ChatCompletionTool,
} from "openai/resources/chat/completions"
import { MessageEvent as UndiciMessageEvent, WebSocket as UndiciWebSocket } from "undici"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/cline/models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { isGPT5ModelFamily } from "@/utils/model-utils"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface OpenAiNativeHandlerOptions extends CommonApiHandlerOptions {
	openAiNativeApiKey?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	apiModelId?: string
	openAiNativeUseResponsesWebsocket?: boolean
}

export class OpenAiNativeHandler implements ApiHandler {
	private options: OpenAiNativeHandlerOptions
	private client: OpenAI | undefined
	private responsesWs: UndiciWebSocket | undefined
	private responsesWsReadyPromise: Promise<UndiciWebSocket> | undefined
	private websocketRequestInFlight = false
	private abortController?: AbortController

	constructor(options: OpenAiNativeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.openAiNativeApiKey) {
				throw new Error("OpenAI API key is required")
			}
			try {
				this.client = createOpenAIClient({
					apiKey: this.options.openAiNativeApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating OpenAI client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0 // sum of cache hits and misses
		const outputTokens = usage?.completion_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0
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

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		// Responses API requires tool format to be set to OPENAI_RESPONSES with native tools calling enabled
		const apiFormat = this.getModel()?.info?.apiFormat
		if (apiFormat === ApiFormat.OPENAI_RESPONSES || apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE) {
			if (!tools?.length) {
				throw new Error("Native Tool Call must be enabled in your setting for OpenAI Responses API")
			}
			yield* this.createResponseStream(systemPrompt, messages, tools)
		} else {
			yield* this.createCompletionStream(systemPrompt, messages, tools)
		}
	}

	private async *createCompletionStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const toolCallProcessor = new ToolCallProcessor()
		this.abortController = new AbortController()

		// Handle o1 models separately as they don't support streaming
		if (model.info.supportsStreaming === false) {
			const response = await client.chat.completions.create(
				{
					model: model.id,
					messages: [{ role: "user", content: systemPrompt }, ...convertToOpenAiMessages(messages, "openai-native")],
				},
				{ signal: this.abortController?.signal },
			)
			yield {
				type: "text",
				text: response.choices[0]?.message.content || "",
			}
			yield* this.yieldUsage(model.info, response.usage)
			return
		}

		const systemRole = model.info.systemRole ?? "system"
		const includeReasoning = model.info.supportsReasoningEffort
		const includeTools = model.info.supportsTools ?? true
		const requestedEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const reasoningEffort =
			includeReasoning && requestedEffort !== "none" ? (requestedEffort as ChatCompletionReasoningEffort) : undefined

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: systemRole, content: systemPrompt }, ...convertToOpenAiMessages(messages, "openai-native")],
			stream: true,
			stream_options: { include_usage: true },
			reasoning_effort: reasoningEffort,
			...(model.info.temperature !== undefined ? { temperature: model.info.temperature } : {}),
			...(includeTools ? getOpenAIToolParams(tools, isGPT5ModelFamily(model.id)) : {}),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				try {
					yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
				} catch (error) {
					Logger.error("Error processing tool call delta:", error, delta.tool_calls)
				}
			}

			if (chunk.usage) {
				// Only last chunk contains usage
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	private async *createResponseStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools: ChatCompletionTool[],
	): ApiStream {
		const model = this.getModel()
		const usePreviousResponseId = this.useWebsocketMode(model.info.apiFormat)

		// Warm websocket connection early in websocket mode so the first response.create avoids handshake latency.
		if (usePreviousResponseId) {
			this.preconnectResponsesWebsocket()
		}

		const { input, previousResponseId } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId })
		const responseTools = this.mapResponseTools(tools)
		this.abortController = new AbortController()

		const params = this.buildResponseCreateParams({
			modelId: model.id,
			systemPrompt,
			input,
			previousResponseId,
			tools: responseTools,
		})

		const fallbackParams = this.buildResponseCreateParams({
			modelId: model.id,
			systemPrompt,
			input,
			tools: responseTools,
		})

		if (usePreviousResponseId && previousResponseId) {
			try {
				yield* this.createResponseStreamWebsocket(model.info, params, fallbackParams)
				return
			} catch (error) {
				Logger.error("OpenAI websocket mode failed, falling back to HTTP Responses API:", error)
				this.closeResponsesWebsocket()
			}
		}

		yield* this.createResponseStreamHttp(model.info, params)
	}

	private preconnectResponsesWebsocket(): void {
		void this.ensureResponsesWebsocket().catch((error) => {
			Logger.debug("OpenAI websocket preconnect failed:", error)
			this.closeResponsesWebsocket()
		})
	}

	private useWebsocketMode(apiFormat?: ApiFormat): boolean {
		if (featureFlagsService.getBooleanFlagEnabled(FeatureFlag.OPENAI_RESPONSES_WEBSOCKET_MODE)) {
			return apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
		}
		return false
	}

	private mapResponseTools(tools: ChatCompletionTool[]): OpenAI.Responses.Tool[] {
		return tools
			?.filter((tool): tool is ChatCompletionFunctionTool => tool?.type === "function")
			.map((tool) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters ?? null,
				strict: tool.function.strict ?? true,
			}))
	}

	private buildResponseCreateParams(args: {
		modelId: string
		systemPrompt: string
		input: OpenAI.Responses.ResponseInput
		tools: OpenAI.Responses.Tool[]
		previousResponseId?: string
	}): OpenAI.Responses.ResponseCreateParamsStreaming {
		const requestedEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const reasoning: { effort: ChatCompletionReasoningEffort; summary: "auto" } | undefined =
			requestedEffort === "none"
				? undefined
				: {
						effort: requestedEffort,
						summary: "auto",
					}

		return {
			model: args.modelId,
			instructions: args.systemPrompt,
			input: args.input,
			stream: true,
			tools: args.tools,
			store: !args.previousResponseId, // Do not use store when websocket mode is enabled.
			...(args.previousResponseId ? { previous_response_id: args.previousResponseId } : {}),
			...(reasoning ? { reasoning } : {}),
		}
	}

	private async *createResponseStreamHttp(
		modelInfo: ModelInfo,
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
	): ApiStream {
		const client = this.ensureClient()
		Logger.debug(`OpenAI Responses Input (HTTP): ${JSON.stringify(params.input)}`)
		const stream = await client.responses.create(params, { signal: this.abortController?.signal })
		yield* this.processResponsesEvents(stream, modelInfo)
	}

	private async *createResponseStreamWebsocket(
		modelInfo: ModelInfo,
		primaryParams: OpenAI.Responses.ResponseCreateParamsStreaming,
		fallbackParams: OpenAI.Responses.ResponseCreateParamsStreaming,
	): ApiStream {
		Logger.debug(`OpenAI Responses Input (WebSocket): ${JSON.stringify(primaryParams.input)}`)
		try {
			yield* this.processResponsesEvents(this.createResponseEventsViaWebsocket(primaryParams), modelInfo)
		} catch (error) {
			if (this.shouldRetryWebsocketWithFullContext(error, !!primaryParams.previous_response_id)) {
				Logger.log("Retrying websocket response with full context after previous_response_not_found or socket reset")
				this.closeResponsesWebsocket()
				yield* this.processResponsesEvents(this.createResponseEventsViaWebsocket(fallbackParams), modelInfo)
				return
			}
			throw error
		}
	}

	private shouldRetryWebsocketWithFullContext(error: unknown, hadPreviousResponseId: boolean): boolean {
		const errorCode =
			typeof error === "object" && error && "code" in error && typeof (error as { code: unknown }).code === "string"
				? (error as { code: string }).code
				: undefined

		if (hadPreviousResponseId && errorCode === "previous_response_not_found") {
			return true
		}
		if (errorCode === "websocket_closed" || errorCode === "websocket_error") {
			return true
		}
		return false
	}

	private async ensureResponsesWebsocket(): Promise<UndiciWebSocket> {
		if (this.responsesWs && this.responsesWs.readyState === UndiciWebSocket.OPEN) {
			return this.responsesWs
		}

		if (this.responsesWsReadyPromise) {
			return this.responsesWsReadyPromise
		}

		this.closeResponsesWebsocket()

		if (!this.options.openAiNativeApiKey) {
			throw new Error("OpenAI API key is required")
		}

		const ws = new UndiciWebSocket("wss://api.openai.com/v1/responses", {
			headers: {
				Authorization: `Bearer ${this.options.openAiNativeApiKey}`,
				"OpenAI-Beta": "responses_websockets=2026-02-06",
				...buildExternalBasicHeaders(),
			},
		})

		this.responsesWs = ws
		const readyPromise = new Promise<UndiciWebSocket>((resolve, reject) => {
			const cleanup = () => {
				ws.removeEventListener("open", handleOpen)
				ws.removeEventListener("error", handleError)
				ws.removeEventListener("close", handleClose)
			}
			const handleOpen = () => {
				cleanup()
				resolve(ws)
			}
			const handleError = () => {
				cleanup()
				reject(new Error("Failed to open Responses websocket"))
			}
			const handleClose = () => {
				cleanup()
				reject(new Error("Responses websocket closed before opening"))
			}
			ws.addEventListener("open", handleOpen)
			ws.addEventListener("error", handleError)
			ws.addEventListener("close", handleClose)
		})

		this.responsesWsReadyPromise = readyPromise

		try {
			return await readyPromise
		} catch (error) {
			if (this.responsesWs === ws) {
				this.responsesWs = undefined
			}
			throw error
		} finally {
			if (this.responsesWsReadyPromise === readyPromise) {
				this.responsesWsReadyPromise = undefined
			}
		}
	}

	private closeResponsesWebsocket() {
		this.responsesWsReadyPromise = undefined
		if (this.responsesWs) {
			try {
				this.responsesWs.close()
			} catch {}
			this.responsesWs = undefined
		}
	}

	private async *createResponseEventsViaWebsocket(
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
	): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
		if (this.websocketRequestInFlight) {
			const error: Error & { code?: string } = new Error("Websocket response.create is already in progress")
			error.code = "websocket_concurrency_limit"
			throw error
		}

		const ws = await this.ensureResponsesWebsocket()
		this.websocketRequestInFlight = true

		const eventQueue: OpenAI.Responses.ResponseStreamEvent[] = []
		let resolver: (() => void) | undefined
		let completed = false
		let failure: (Error & { code?: string }) | undefined

		const wake = () => {
			const next = resolver
			resolver = undefined
			next?.()
		}

		const handleMessage = (evt: UndiciMessageEvent) => {
			try {
				let raw = ""
				if (typeof evt.data === "string") {
					raw = evt.data
				} else if (evt.data instanceof ArrayBuffer) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data))
				} else if (ArrayBuffer.isView(evt.data)) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data.buffer, evt.data.byteOffset, evt.data.byteLength))
				} else {
					raw = String(evt.data)
				}
				const parsed = JSON.parse(raw)

				if (parsed?.type === "error" && parsed?.error) {
					const error: Error & { code?: string } = new Error(parsed.error.message || "Responses websocket error")
					error.code = parsed.error.code
					failure = error
					completed = true
					wake()
					return
				}

				eventQueue.push(parsed as OpenAI.Responses.ResponseStreamEvent)
				if (parsed?.type === "response.completed" || parsed?.type === "response.failed") {
					completed = true
				}
				wake()
			} catch (error) {
				const parseError: Error & { code?: string } = new Error(
					`Failed to parse websocket event: ${error instanceof Error ? error.message : String(error)}`,
				)
				parseError.code = "websocket_parse_error"
				failure = parseError
				completed = true
				wake()
			}
		}

		const handleError = () => {
			const error: Error & { code?: string } = new Error("Responses websocket emitted an error event")
			error.code = "websocket_error"
			failure = error
			completed = true
			wake()
		}

		const handleClose = () => {
			if (!completed) {
				const error: Error & { code?: string } = new Error("Responses websocket closed during response stream")
				error.code = "websocket_closed"
				failure = error
				completed = true
				wake()
			}
		}

		ws.addEventListener("message", handleMessage)
		ws.addEventListener("error", handleError)
		ws.addEventListener("close", handleClose)

		try {
			ws.send(
				JSON.stringify({
					type: "response.create",
					...params,
				}),
			)

			while (!completed || eventQueue.length > 0) {
				if (eventQueue.length === 0) {
					await new Promise<void>((resolve) => {
						resolver = resolve
					})
					continue
				}

				const event = eventQueue.shift()
				if (event) {
					yield event
				}
			}

			if (failure) {
				throw failure
			}
		} finally {
			ws.removeEventListener("message", handleMessage)
			ws.removeEventListener("error", handleError)
			ws.removeEventListener("close", handleClose)
			this.websocketRequestInFlight = false
		}
	}

	private async *processResponsesEvents(
		stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
		modelInfo: ModelInfo,
	): ApiStream {
		const functionCallByItemId = new Map<string, { call_id?: string; name?: string; id?: string }>()

		for await (const chunk of stream) {
			Logger.debug(`OpenAI Responses Chunk: ${JSON.stringify(chunk)}`)

			if (chunk.type === "response.output_item.added") {
				const item = chunk.item
				if (item.type === "function_call" && item.id) {
					functionCallByItemId.set(item.id, { call_id: item.call_id, name: item.name, id: item.id })
					yield {
						type: "tool_calls",
						id: item.id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning" && item.encrypted_content && item.id) {
					yield {
						type: "reasoning",
						id: item.id,
						reasoning: "",
						redacted_data: item.encrypted_content,
					}
				}
			}
			if (chunk.type === "response.output_item.done") {
				const item = chunk.item
				if (item.type === "function_call") {
					if (item.id) {
						functionCallByItemId.set(item.id, { call_id: item.call_id, name: item.name, id: item.id })
					}
					yield {
						type: "tool_calls",
						id: item.id || item.call_id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning") {
					yield {
						type: "reasoning",
						id: item.id,
						details: item.summary,
						reasoning: "",
					}
				}
			}
			if (chunk.type === "response.reasoning_summary_part.added") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.part.text,
				}
			}
			if (chunk.type === "response.reasoning_summary_text.delta") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.delta,
				}
			}
			if (chunk.type === "response.reasoning_summary_part.done") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					details: chunk.part,
					reasoning: "",
				}
			}
			if (chunk.type === "response.output_text.delta") {
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "text",
						text: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.reasoning_text.delta") {
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "reasoning",
						reasoning: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.function_call_arguments.delta") {
				const pendingCall = functionCallByItemId.get(chunk.item_id)
				const callId = pendingCall?.call_id
				const functionName = pendingCall?.name
				const functionId = pendingCall?.id || chunk.item_id

				yield {
					type: "tool_calls",
					tool_call: {
						call_id: callId,
						function: {
							id: functionId,
							name: functionName,
							arguments: chunk.delta,
						},
					},
				}
			}
			if (chunk.type === "response.function_call_arguments.done") {
				if (chunk.item_id && chunk.name && chunk.arguments) {
					const pendingCall = functionCallByItemId.get(chunk.item_id)
					const callId = pendingCall?.call_id
					const functionId = pendingCall?.id || chunk.item_id

					yield {
						type: "tool_calls",
						tool_call: {
							call_id: callId,
							function: {
								id: functionId,
								name: chunk.name,
								arguments: chunk.arguments,
							},
						},
					}
				}
			}

			if (
				chunk.type === "response.incomplete" &&
				chunk.response?.status === "incomplete" &&
				chunk.response?.incomplete_details?.reason === "max_output_tokens"
			) {
				if (chunk.response?.output_text?.length > 0) {
					Logger.log("Partial output:", chunk.response.output_text)
				} else {
					Logger.log("Ran out of tokens during reasoning")
				}
			}

			if (chunk.type === "response.completed" && chunk.response?.usage) {
				const usage = chunk.response.usage
				const inputTokens = usage.input_tokens || 0
				const outputTokens = usage.output_tokens || 0
				const cacheReadTokens = usage.input_tokens_details?.cached_tokens || 0
				const cacheWriteTokens = 0
				const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0
				const totalTokens = usage.total_tokens || 0
				Logger.log(`Total tokens from Responses API usage: ${totalTokens}`)
				const totalCost = calculateApiCostOpenAI(
					modelInfo,
					inputTokens,
					outputTokens + reasoningTokens,
					cacheWriteTokens,
					cacheReadTokens,
				)
				const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
				yield {
					type: "usage",
					inputTokens: nonCachedInputTokens,
					outputTokens: outputTokens,
					cacheWriteTokens: cacheWriteTokens,
					cacheReadTokens: cacheReadTokens,
					thoughtsTokenCount: reasoningTokens,
					totalCost: totalCost,
					id: chunk.response.id,
				}
			}
		}
	}

	abort(): void {
		this.closeResponsesWebsocket()
		this.abortController?.abort()
		this.abortController = undefined
	}

	getModel(): { id: OpenAiNativeModelId; info: OpenAiCompatibleModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			const info = openAiNativeModels[id]
			return { id, info: { ...info } }
		}
		return {
			id: openAiNativeDefaultModelId,
			info: { ...openAiNativeModels[openAiNativeDefaultModelId] },
		}
	}
}
