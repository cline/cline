import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
	OPENAI_NATIVE_DEFAULT_TEMPERATURE,
	GPT5_DEFAULT_TEMPERATURE,
	type ReasoningEffort,
	type VerbosityLevel,
	type ReasoningEffortWithMinimal,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { calculateApiCostOpenAI } from "../../shared/cost"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

export type OpenAiNativeModel = ReturnType<OpenAiNativeHandler["getModel"]>

// GPT-5 specific types

export class OpenAiNativeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	private lastResponseId: string | undefined
	private responseIdPromise: Promise<string | undefined> | undefined
	private responseIdResolver: ((value: string | undefined) => void) | undefined

	// Event types handled by the shared GPT-5 event processor to avoid duplication
	private readonly gpt5CoreHandledTypes = new Set<string>([
		"response.text.delta",
		"response.output_text.delta",
		"response.reasoning.delta",
		"response.reasoning_text.delta",
		"response.reasoning_summary.delta",
		"response.reasoning_summary_text.delta",
		"response.refusal.delta",
		"response.output_item.added",
		"response.done",
		"response.completed",
	])

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Default to including reasoning.summary: "auto" for GPT‑5 unless explicitly disabled
		if (this.options.enableGpt5ReasoningSummary === undefined) {
			this.options.enableGpt5ReasoningSummary = true
		}
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		this.client = new OpenAI({ baseURL: this.options.openAiNativeBaseUrl, apiKey })
	}

	private normalizeGpt5Usage(usage: any, model: OpenAiNativeModel): ApiStreamUsageChunk | undefined {
		if (!usage) return undefined

		const totalInputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
		const totalOutputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0
		const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0
		const cacheReadTokens = usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? 0

		const totalCost = calculateApiCostOpenAI(
			model.info,
			totalInputTokens,
			totalOutputTokens,
			cacheWriteTokens || 0,
			cacheReadTokens || 0,
		)

		return {
			type: "usage",
			inputTokens: totalInputTokens,
			outputTokens: totalOutputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			totalCost,
		}
	}

	private resolveResponseId(responseId: string | undefined): void {
		if (responseId) {
			this.lastResponseId = responseId
		}
		// Resolve the promise so the next request can use this ID
		if (this.responseIdResolver) {
			this.responseIdResolver(responseId)
			this.responseIdResolver = undefined
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const model = this.getModel()
		let id: "o3-mini" | "o3" | "o4-mini" | undefined

		if (model.id.startsWith("o3-mini")) {
			id = "o3-mini"
		} else if (model.id.startsWith("o3")) {
			id = "o3"
		} else if (model.id.startsWith("o4-mini")) {
			id = "o4-mini"
		}

		if (id) {
			yield* this.handleReasonerMessage(model, id, systemPrompt, messages)
		} else if (model.id.startsWith("o1")) {
			yield* this.handleO1FamilyMessage(model, systemPrompt, messages)
		} else if (this.isResponsesApiModel(model.id)) {
			// Both GPT-5 and Codex Mini use the v1/responses endpoint
			yield* this.handleResponsesApiMessage(model, systemPrompt, messages, metadata)
		} else {
			yield* this.handleDefaultModelMessage(model, systemPrompt, messages)
		}
	}

	private async *handleO1FamilyMessage(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		// o1 supports developer prompt with formatting
		// o1-preview and o1-mini only support user messages
		const isOriginalO1 = model.id === "o1"
		const { reasoning } = this.getModel()

		const response = await this.client.chat.completions.create({
			model: model.id,
			messages: [
				{
					role: isOriginalO1 ? "developer" : "user",
					content: isOriginalO1 ? `Formatting re-enabled\n${systemPrompt}` : systemPrompt,
				},
				...convertToOpenAiMessages(messages),
			],
			stream: true,
			stream_options: { include_usage: true },
			...(reasoning && reasoning),
		})

		yield* this.handleStreamResponse(response, model)
	}

	private async *handleReasonerMessage(
		model: OpenAiNativeModel,
		family: "o3-mini" | "o3" | "o4-mini",
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		const { reasoning } = this.getModel()

		const stream = await this.client.chat.completions.create({
			model: family,
			messages: [
				{
					role: "developer",
					content: `Formatting re-enabled\n${systemPrompt}`,
				},
				...convertToOpenAiMessages(messages),
			],
			stream: true,
			stream_options: { include_usage: true },
			...(reasoning && reasoning),
		})

		yield* this.handleStreamResponse(stream, model)
	}

	private async *handleDefaultModelMessage(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		const { reasoning, verbosity } = this.getModel()

		// Prepare the request parameters
		const params: any = {
			model: model.id,
			temperature: this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(reasoning && reasoning),
		}

		// Add verbosity only if the model supports it
		if (verbosity && model.info.supportsVerbosity) {
			params.verbosity = verbosity
		}

		const stream = await this.client.chat.completions.create(params)

		if (typeof (stream as any)[Symbol.asyncIterator] !== "function") {
			throw new Error(
				"OpenAI SDK did not return an AsyncIterable for streaming response. Please check SDK version and usage.",
			)
		}

		yield* this.handleStreamResponse(
			stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
			model,
		)
	}

	private async *handleResponsesApiMessage(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Prefer the official SDK Responses API with streaming; fall back to fetch-based SSE if needed.
		const { verbosity } = this.getModel()

		// Both GPT-5 and Codex Mini use the same v1/responses endpoint format

		// Resolve reasoning effort (supports "minimal" for GPT‑5)
		const reasoningEffort = this.getGpt5ReasoningEffort(model)

		// Wait for any pending response ID from a previous request to be available
		// This handles the race condition with fast nano model responses
		let effectivePreviousResponseId = metadata?.previousResponseId

		// Only allow fallback to pending/last response id when not explicitly suppressed
		if (!metadata?.suppressPreviousResponseId) {
			// If we have a pending response ID promise, wait for it to resolve
			if (!effectivePreviousResponseId && this.responseIdPromise) {
				try {
					const resolvedId = await Promise.race([
						this.responseIdPromise,
						// Timeout after 100ms to avoid blocking too long
						new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 100)),
					])
					if (resolvedId) {
						effectivePreviousResponseId = resolvedId
					}
				} catch {
					// Non-fatal if promise fails
				}
			}

			// Fall back to the last known response ID if still not available
			if (!effectivePreviousResponseId) {
				effectivePreviousResponseId = this.lastResponseId
			}
		}

		// Format input and capture continuity id
		const { formattedInput, previousResponseId } = this.prepareGpt5Input(systemPrompt, messages, metadata)
		const requestPreviousResponseId = effectivePreviousResponseId ?? previousResponseId

		// Create a new promise for this request's response ID
		this.responseIdPromise = new Promise<string | undefined>((resolve) => {
			this.responseIdResolver = resolve
		})

		// Build a request body (also used for fallback)
		// Ensure we explicitly pass max_output_tokens for GPT‑5 based on Roo's reserved model response calculation
		// so requests do not default to very large limits (e.g., 120k).
		interface Gpt5RequestBody {
			model: string
			input: string
			stream: boolean
			reasoning?: { effort: ReasoningEffortWithMinimal; summary?: "auto" }
			text?: { verbosity: VerbosityLevel }
			temperature?: number
			max_output_tokens?: number
			previous_response_id?: string
		}

		const requestBody: Gpt5RequestBody = {
			model: model.id,
			input: formattedInput,
			stream: true,
			...(reasoningEffort && {
				reasoning: {
					effort: reasoningEffort,
					...(this.options.enableGpt5ReasoningSummary ? { summary: "auto" as const } : {}),
				},
			}),
			text: { verbosity: (verbosity || "medium") as VerbosityLevel },
			temperature: this.options.modelTemperature ?? GPT5_DEFAULT_TEMPERATURE,
			// Explicitly include the calculated max output tokens for GPT‑5.
			// Use the per-request reserved output computed by Roo (params.maxTokens from getModelParams).
			...(model.maxTokens ? { max_output_tokens: model.maxTokens } : {}),
			...(requestPreviousResponseId && { previous_response_id: requestPreviousResponseId }),
		}

		try {
			// Use the official SDK
			const stream = (await (this.client as any).responses.create(requestBody)) as AsyncIterable<any>

			if (typeof (stream as any)[Symbol.asyncIterator] !== "function") {
				throw new Error(
					"OpenAI SDK did not return an AsyncIterable for Responses API streaming. Falling back to SSE.",
				)
			}

			for await (const event of stream) {
				for await (const outChunk of this.processGpt5Event(event, model)) {
					yield outChunk
				}
			}
		} catch (sdkErr: any) {
			// Check if this is a 400 error about previous_response_id not found
			const errorMessage = sdkErr?.message || sdkErr?.error?.message || ""
			const is400Error = sdkErr?.status === 400 || sdkErr?.response?.status === 400
			const isPreviousResponseError =
				errorMessage.includes("Previous response") || errorMessage.includes("not found")

			if (is400Error && requestBody.previous_response_id && isPreviousResponseError) {
				// Log the error and retry without the previous_response_id
				console.warn(
					`[GPT-5] Previous response ID not found (${requestBody.previous_response_id}), retrying without it`,
				)

				// Remove the problematic previous_response_id and retry
				const retryRequestBody = { ...requestBody }
				delete retryRequestBody.previous_response_id

				// Clear the stored lastResponseId to prevent using it again
				this.lastResponseId = undefined

				try {
					// Retry with the SDK
					const retryStream = (await (this.client as any).responses.create(
						retryRequestBody,
					)) as AsyncIterable<any>

					if (typeof (retryStream as any)[Symbol.asyncIterator] !== "function") {
						// If SDK fails, fall back to SSE
						yield* this.makeGpt5ResponsesAPIRequest(retryRequestBody, model, metadata)
						return
					}

					for await (const event of retryStream) {
						for await (const outChunk of this.processGpt5Event(event, model)) {
							yield outChunk
						}
					}
					return
				} catch (retryErr) {
					// If retry also fails, fall back to SSE
					yield* this.makeGpt5ResponsesAPIRequest(retryRequestBody, model, metadata)
					return
				}
			}

			// For other errors, fallback to manual SSE via fetch
			yield* this.makeGpt5ResponsesAPIRequest(requestBody, model, metadata)
		}
	}

	private formatInputForResponsesAPI(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
		// Format the conversation for the Responses API input field
		// Use Developer role format for GPT-5 (aligning with o1/o3 Developer role usage per GPT-5 Responses guidance)
		// This ensures consistent instruction handling across reasoning models
		let formattedInput = `Developer: ${systemPrompt}\n\n`

		for (const message of messages) {
			const role = message.role === "user" ? "User" : "Assistant"

			// Handle text content
			if (typeof message.content === "string") {
				formattedInput += `${role}: ${message.content}\n\n`
			} else if (Array.isArray(message.content)) {
				// Handle content blocks
				const textContent = message.content
					.filter((block) => block.type === "text")
					.map((block) => (block as any).text)
					.join("\n")
				if (textContent) {
					formattedInput += `${role}: ${textContent}\n\n`
				}
			}
		}

		return formattedInput.trim()
	}

	private formatSingleMessageForResponsesAPI(message: Anthropic.Messages.MessageParam): string {
		// Format a single message for the Responses API when using previous_response_id
		const role = message.role === "user" ? "User" : "Assistant"

		// Handle text content
		if (typeof message.content === "string") {
			return `${role}: ${message.content}`
		} else if (Array.isArray(message.content)) {
			// Handle content blocks
			const textContent = message.content
				.filter((block) => block.type === "text")
				.map((block) => (block as any).text)
				.join("\n")
			if (textContent) {
				return `${role}: ${textContent}`
			}
		}

		return ""
	}

	private async *makeGpt5ResponsesAPIRequest(
		requestBody: any,
		model: OpenAiNativeModel,
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		const baseUrl = this.options.openAiNativeBaseUrl || "https://api.openai.com"
		const url = `${baseUrl}/v1/responses`

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					Accept: "text/event-stream",
				},
				body: JSON.stringify(requestBody),
			})

			if (!response.ok) {
				const errorText = await response.text()

				let errorMessage = `GPT-5 API request failed (${response.status})`
				let errorDetails = ""

				// Try to parse error as JSON for better error messages
				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorDetails = errorJson.error.message
					} else if (errorJson.message) {
						errorDetails = errorJson.message
					} else {
						errorDetails = errorText
					}
				} catch {
					// If not JSON, use the raw text
					errorDetails = errorText
				}

				// Check if this is a 400 error about previous_response_id not found
				const isPreviousResponseError =
					errorDetails.includes("Previous response") || errorDetails.includes("not found")

				if (response.status === 400 && requestBody.previous_response_id && isPreviousResponseError) {
					// Log the error and retry without the previous_response_id
					console.warn(
						`[GPT-5 SSE] Previous response ID not found (${requestBody.previous_response_id}), retrying without it`,
					)

					// Remove the problematic previous_response_id and retry
					const retryRequestBody = { ...requestBody }
					delete retryRequestBody.previous_response_id

					// Clear the stored lastResponseId to prevent using it again
					this.lastResponseId = undefined
					// Resolve the promise once to unblock any waiting requests
					this.resolveResponseId(undefined)

					// Retry the request without the previous_response_id
					const retryResponse = await fetch(url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${apiKey}`,
							Accept: "text/event-stream",
						},
						body: JSON.stringify(retryRequestBody),
					})

					if (!retryResponse.ok) {
						// If retry also fails, throw the original error
						throw new Error(`GPT-5 API retry failed (${retryResponse.status})`)
					}

					if (!retryResponse.body) {
						throw new Error("GPT-5 Responses API error: No response body from retry request")
					}

					// Handle the successful retry response
					yield* this.handleGpt5StreamResponse(retryResponse.body, model)
					return
				}

				// Provide user-friendly error messages based on status code
				switch (response.status) {
					case 400:
						errorMessage = "Invalid request to GPT-5 API. Please check your input parameters."
						break
					case 401:
						errorMessage = "Authentication failed. Please check your OpenAI API key."
						break
					case 403:
						errorMessage = "Access denied. Your API key may not have access to GPT-5 models."
						break
					case 404:
						errorMessage =
							"GPT-5 API endpoint not found. The model may not be available yet or requires a different configuration."
						break
					case 429:
						errorMessage = "Rate limit exceeded. Please try again later."
						break
					case 500:
					case 502:
					case 503:
						errorMessage = "OpenAI service error. Please try again later."
						break
					default:
						errorMessage = `GPT-5 API error (${response.status})`
				}

				// Append details if available
				if (errorDetails) {
					errorMessage += ` - ${errorDetails}`
				}

				throw new Error(errorMessage)
			}

			if (!response.body) {
				throw new Error("GPT-5 Responses API error: No response body")
			}

			// Handle streaming response
			yield* this.handleGpt5StreamResponse(response.body, model)
		} catch (error) {
			if (error instanceof Error) {
				// Re-throw with the original error message if it's already formatted
				if (error.message.includes("GPT-5")) {
					throw error
				}
				// Otherwise, wrap it with context
				throw new Error(`Failed to connect to GPT-5 API: ${error.message}`)
			}
			// Handle non-Error objects
			throw new Error(`Unexpected error connecting to GPT-5 API`)
		}
	}

	/**
	 * Prepares the input and conversation continuity parameters for a GPT-5 API call.
	 *
	 * - If a `previousResponseId` is available (either from metadata or the handler's state),
	 *   it formats only the most recent user message for the input and returns the response ID
	 *   to maintain conversation context.
	 * - Otherwise, it formats the entire conversation history (system prompt + messages) for the input.
	 *
	 * @returns An object containing the formatted input string and the previous response ID (if used).
	 */
	private prepareGpt5Input(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): { formattedInput: string; previousResponseId?: string } {
		// Respect explicit suppression signal for continuity (e.g. immediately after condense)
		const isFirstMessage = messages.length === 1 && messages[0].role === "user"
		const allowFallback = !metadata?.suppressPreviousResponseId

		const previousResponseId =
			metadata?.previousResponseId ?? (allowFallback && !isFirstMessage ? this.lastResponseId : undefined)

		if (previousResponseId) {
			const lastUserMessage = [...messages].reverse().find((msg) => msg.role === "user")
			const formattedInput = lastUserMessage ? this.formatSingleMessageForResponsesAPI(lastUserMessage) : ""
			return { formattedInput, previousResponseId }
		} else {
			const formattedInput = this.formatInputForResponsesAPI(systemPrompt, messages)
			return { formattedInput }
		}
	}

	/**
	 * Handles the streaming response from the GPT-5 Responses API.
	 *
	 * This function iterates through the Server-Sent Events (SSE) stream, parses each event,
	 * and yields structured data chunks (`ApiStream`). It handles a wide variety of event types,
	 * including text deltas, reasoning, usage data, and various status/tool events.
	 *
	 * The following event types are intentionally ignored as they are not currently consumed
	 * by the client application:
	 * - Audio events (`response.audio.*`)
	 * - Most tool call events (e.g., `response.function_call_arguments.*`, `response.mcp_call.*`, etc.)
	 *   as the client does not yet support rendering these tool interactions.
	 * - Status events (`response.created`, `response.in_progress`, etc.) as they are informational
	 *   and do not affect the final output.
	 */
	private async *handleGpt5StreamResponse(body: ReadableStream<Uint8Array>, model: OpenAiNativeModel): ApiStream {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""
		let hasContent = false
		let totalInputTokens = 0
		let totalOutputTokens = 0

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							continue
						}

						try {
							const parsed = JSON.parse(data)

							// Store response ID for conversation continuity
							if (parsed.response?.id) {
								this.resolveResponseId(parsed.response.id)
							}

							// Delegate standard event types to the shared processor to avoid duplication
							if (parsed?.type && this.gpt5CoreHandledTypes.has(parsed.type)) {
								for await (const outChunk of this.processGpt5Event(parsed, model)) {
									// Track whether we've emitted any content so fallback handling can decide appropriately
									if (outChunk.type === "text" || outChunk.type === "reasoning") {
										hasContent = true
									}
									yield outChunk
								}
								continue
							}

							// Check if this is a complete response (non-streaming format)
							if (parsed.response && parsed.response.output && Array.isArray(parsed.response.output)) {
								// Handle complete response in the initial event
								for (const outputItem of parsed.response.output) {
									if (outputItem.type === "text" && outputItem.content) {
										for (const content of outputItem.content) {
											if (content.type === "text" && content.text) {
												hasContent = true
												yield {
													type: "text",
													text: content.text,
												}
											}
										}
									}
									// Additionally handle reasoning summaries if present (non-streaming summary output)
									if (outputItem.type === "reasoning" && Array.isArray(outputItem.summary)) {
										for (const summary of outputItem.summary) {
											if (summary?.type === "summary_text" && typeof summary.text === "string") {
												hasContent = true
												yield {
													type: "reasoning",
													text: summary.text,
												}
											}
										}
									}
								}
								// Check for usage in the complete response
								if (parsed.response.usage) {
									const usageData = this.normalizeGpt5Usage(parsed.response.usage, model)
									if (usageData) {
										yield usageData
									}
								}
							}
							// Handle streaming delta events for text content
							else if (
								parsed.type === "response.text.delta" ||
								parsed.type === "response.output_text.delta"
							) {
								// Primary streaming event for text deltas
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "text",
										text: parsed.delta,
									}
								}
							} else if (
								parsed.type === "response.text.done" ||
								parsed.type === "response.output_text.done"
							) {
								// Text streaming completed - final text already streamed via deltas
							}
							// Handle reasoning delta events
							else if (
								parsed.type === "response.reasoning.delta" ||
								parsed.type === "response.reasoning_text.delta"
							) {
								// Streaming reasoning content
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "reasoning",
										text: parsed.delta,
									}
								}
							} else if (
								parsed.type === "response.reasoning.done" ||
								parsed.type === "response.reasoning_text.done"
							) {
								// Reasoning streaming completed
							}
							// Handle reasoning summary events
							else if (
								parsed.type === "response.reasoning_summary.delta" ||
								parsed.type === "response.reasoning_summary_text.delta"
							) {
								// Streaming reasoning summary
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "reasoning",
										text: parsed.delta,
									}
								}
							} else if (
								parsed.type === "response.reasoning_summary.done" ||
								parsed.type === "response.reasoning_summary_text.done"
							) {
								// Reasoning summary completed
							}
							// Handle refusal delta events
							else if (parsed.type === "response.refusal.delta") {
								// Model is refusing to answer
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "text",
										text: `[Refusal] ${parsed.delta}`,
									}
								}
							} else if (parsed.type === "response.refusal.done") {
								// Refusal completed
							}
							// Handle audio delta events (for multimodal responses)
							else if (parsed.type === "response.audio.delta") {
								// Audio streaming - we'll skip for now as we focus on text
								// Could be handled in future for voice responses
							} else if (parsed.type === "response.audio.done") {
								// Audio completed
							}
							// Handle audio transcript delta events
							else if (parsed.type === "response.audio_transcript.delta") {
								// Audio transcript streaming
								if (parsed.delta) {
									hasContent = true
									yield {
										type: "text",
										text: parsed.delta,
									}
								}
							} else if (parsed.type === "response.audio_transcript.done") {
								// Audio transcript completed
							}
							// Handle content part events (for structured content)
							else if (parsed.type === "response.content_part.added") {
								// New content part added - could be text, image, etc.
								if (parsed.part?.type === "text" && parsed.part.text) {
									hasContent = true
									yield {
										type: "text",
										text: parsed.part.text,
									}
								}
							} else if (parsed.type === "response.content_part.done") {
								// Content part completed
							}
							// Handle output item events (alternative format)
							else if (parsed.type === "response.output_item.added") {
								// This is where the actual content comes through in some test cases
								if (parsed.item) {
									if (parsed.item.type === "text" && parsed.item.text) {
										hasContent = true
										yield { type: "text", text: parsed.item.text }
									} else if (parsed.item.type === "reasoning" && parsed.item.text) {
										hasContent = true
										yield { type: "reasoning", text: parsed.item.text }
									} else if (parsed.item.type === "message" && parsed.item.content) {
										// Handle message type items
										for (const content of parsed.item.content) {
											if (content.type === "text" && content.text) {
												hasContent = true
												yield { type: "text", text: content.text }
											}
										}
									}
								}
							} else if (parsed.type === "response.output_item.done") {
								// Output item completed
							}
							// Handle function/tool call events
							else if (parsed.type === "response.function_call_arguments.delta") {
								// Function call arguments streaming
								// We could yield this as a special type if needed for tool usage
							} else if (parsed.type === "response.function_call_arguments.done") {
								// Function call completed
							}
							// Handle MCP (Model Context Protocol) tool events
							else if (parsed.type === "response.mcp_call_arguments.delta") {
								// MCP tool call arguments streaming
							} else if (parsed.type === "response.mcp_call_arguments.done") {
								// MCP tool call completed
							} else if (parsed.type === "response.mcp_call.in_progress") {
								// MCP tool call in progress
							} else if (
								parsed.type === "response.mcp_call.completed" ||
								parsed.type === "response.mcp_call.failed"
							) {
								// MCP tool call status events
							} else if (parsed.type === "response.mcp_list_tools.in_progress") {
								// MCP list tools in progress
							} else if (
								parsed.type === "response.mcp_list_tools.completed" ||
								parsed.type === "response.mcp_list_tools.failed"
							) {
								// MCP list tools status events
							}
							// Handle web search events
							else if (parsed.type === "response.web_search_call.searching") {
								// Web search in progress
							} else if (parsed.type === "response.web_search_call.in_progress") {
								// Processing web search results
							} else if (parsed.type === "response.web_search_call.completed") {
								// Web search completed
							}
							// Handle code interpreter events
							else if (parsed.type === "response.code_interpreter_call_code.delta") {
								// Code interpreter code streaming
								if (parsed.delta) {
									// Could yield as a special code type if needed
								}
							} else if (parsed.type === "response.code_interpreter_call_code.done") {
								// Code interpreter code completed
							} else if (parsed.type === "response.code_interpreter_call.interpreting") {
								// Code interpreter running
							} else if (parsed.type === "response.code_interpreter_call.in_progress") {
								// Code execution in progress
							} else if (parsed.type === "response.code_interpreter_call.completed") {
								// Code interpreter completed
							}
							// Handle file search events
							else if (parsed.type === "response.file_search_call.searching") {
								// File search in progress
							} else if (parsed.type === "response.file_search_call.in_progress") {
								// Processing file search results
							} else if (parsed.type === "response.file_search_call.completed") {
								// File search completed
							}
							// Handle image generation events
							else if (parsed.type === "response.image_gen_call.generating") {
								// Image generation in progress
							} else if (parsed.type === "response.image_gen_call.in_progress") {
								// Processing image generation
							} else if (parsed.type === "response.image_gen_call.partial_image") {
								// Image partially generated
							} else if (parsed.type === "response.image_gen_call.completed") {
								// Image generation completed
							}
							// Handle computer use events
							else if (
								parsed.type === "response.computer_tool_call.output_item" ||
								parsed.type === "response.computer_tool_call.output_screenshot"
							) {
								// Computer use tool events
							}
							// Handle annotation events
							else if (
								parsed.type === "response.output_text_annotation.added" ||
								parsed.type === "response.text_annotation.added"
							) {
								// Text annotation events - could be citations, references, etc.
							}
							// Handle error events
							else if (parsed.type === "response.error" || parsed.type === "error") {
								// Error event from the API
								if (parsed.error || parsed.message) {
									throw new Error(
										`Responses API error: ${parsed.error?.message || parsed.message || "Unknown error"}`,
									)
								}
							}
							// Handle incomplete event
							else if (parsed.type === "response.incomplete") {
								// Response was incomplete - might need to handle specially
							}
							// Handle queued event
							else if (parsed.type === "response.queued") {
								// Response is queued
							}
							// Handle in_progress event
							else if (parsed.type === "response.in_progress") {
								// Response is being processed
							}
							// Handle failed event
							else if (parsed.type === "response.failed") {
								// Response failed
								if (parsed.error || parsed.message) {
									throw new Error(
										`GPT-5 response failed: ${parsed.error?.message || parsed.message || "Unknown failure"}`,
									)
								}
							} else if (parsed.type === "response.completed" || parsed.type === "response.done") {
								// Store response ID for conversation continuity
								if (parsed.response?.id) {
									this.resolveResponseId(parsed.response.id)
								}

								// Check if the done event contains the complete output (as a fallback)
								if (
									!hasContent &&
									parsed.response &&
									parsed.response.output &&
									Array.isArray(parsed.response.output)
								) {
									for (const outputItem of parsed.response.output) {
										if (outputItem.type === "message" && outputItem.content) {
											for (const content of outputItem.content) {
												if (content.type === "output_text" && content.text) {
													hasContent = true
													yield {
														type: "text",
														text: content.text,
													}
												}
											}
										}
										// Also surface reasoning summaries if present in the final output
										if (outputItem.type === "reasoning" && Array.isArray(outputItem.summary)) {
											for (const summary of outputItem.summary) {
												if (
													summary?.type === "summary_text" &&
													typeof summary.text === "string"
												) {
													hasContent = true
													yield {
														type: "reasoning",
														text: summary.text,
													}
												}
											}
										}
									}
								}

								// Usage for done/completed is already handled by processGpt5Event in SDK path.
								// For SSE path, usage often arrives separately; avoid double-emitting here.
							}
							// These are structural or status events, we can just log them at a lower level or ignore.
							else if (
								parsed.type === "response.created" ||
								parsed.type === "response.in_progress" ||
								parsed.type === "response.output_item.done" ||
								parsed.type === "response.content_part.added" ||
								parsed.type === "response.content_part.done"
							) {
								// Status events - no action needed
							}
							// Fallback for older formats or unexpected responses
							else if (parsed.choices?.[0]?.delta?.content) {
								hasContent = true
								yield {
									type: "text",
									text: parsed.choices[0].delta.content,
								}
							}
							// Additional fallback: some events place text under 'item.text' even if type isn't matched above
							else if (
								parsed.item &&
								typeof parsed.item.text === "string" &&
								parsed.item.text.length > 0
							) {
								hasContent = true
								yield {
									type: "text",
									text: parsed.item.text,
								}
							} else if (parsed.usage) {
								// Handle usage if it arrives in a separate, non-completed event
								const usageData = this.normalizeGpt5Usage(parsed.usage, model)
								if (usageData) {
									yield usageData
								}
							}
						} catch (e) {
							// Only ignore JSON parsing errors, re-throw actual API errors
							if (!(e instanceof SyntaxError)) {
								throw e
							}
						}
					}
					// Also try to parse non-SSE formatted lines
					else if (line.trim() && !line.startsWith(":")) {
						try {
							const parsed = JSON.parse(line)

							// Try to extract content from various possible locations
							if (parsed.content || parsed.text || parsed.message) {
								hasContent = true
								yield {
									type: "text",
									text: parsed.content || parsed.text || parsed.message,
								}
							}
						} catch {
							// Not JSON, might be plain text - ignore
						}
					}
				}
			}

			// If we didn't get any content, don't throw - the API might have returned an empty response
			// This can happen in certain edge cases and shouldn't break the flow
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Error processing GPT-5 response stream: ${error.message}`)
			}
			throw new Error("Unexpected error processing GPT-5 response stream")
		} finally {
			reader.releaseLock()
		}
	}

	/**
	 * Shared processor for GPT‑5 Responses API events.
	 * Used by both the official SDK streaming path and (optionally) by the SSE fallback.
	 */
	private async *processGpt5Event(event: any, model: OpenAiNativeModel): ApiStream {
		// Persist response id for conversation continuity when available
		if (event?.response?.id) {
			this.resolveResponseId(event.response.id)
		}

		// Handle known streaming text deltas
		if (event?.type === "response.text.delta" || event?.type === "response.output_text.delta") {
			if (event?.delta) {
				yield { type: "text", text: event.delta }
			}
			return
		}

		// Handle reasoning deltas (including summary variants)
		if (
			event?.type === "response.reasoning.delta" ||
			event?.type === "response.reasoning_text.delta" ||
			event?.type === "response.reasoning_summary.delta" ||
			event?.type === "response.reasoning_summary_text.delta"
		) {
			if (event?.delta) {
				yield { type: "reasoning", text: event.delta }
			}
			return
		}

		// Handle refusal deltas
		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				yield { type: "text", text: `[Refusal] ${event.delta}` }
			}
			return
		}

		// Handle output item additions (SDK or Responses API alternative format)
		if (event?.type === "response.output_item.added") {
			const item = event?.item
			if (item) {
				if (item.type === "text" && item.text) {
					yield { type: "text", text: item.text }
				} else if (item.type === "reasoning" && item.text) {
					yield { type: "reasoning", text: item.text }
				} else if (item.type === "message" && Array.isArray(item.content)) {
					for (const content of item.content) {
						// Some implementations send 'text'; others send 'output_text'
						if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
							yield { type: "text", text: content.text }
						}
					}
				}
			}
			return
		}

		// Completion events that may carry usage
		if (event?.type === "response.done" || event?.type === "response.completed") {
			const usage = event?.response?.usage || event?.usage || undefined
			const usageData = this.normalizeGpt5Usage(usage, model)
			if (usageData) {
				yield usageData
			}
			return
		}

		// Fallbacks for older formats or unexpected objects
		if (event?.choices?.[0]?.delta?.content) {
			yield { type: "text", text: event.choices[0].delta.content }
			return
		}

		if (event?.usage) {
			const usageData = this.normalizeGpt5Usage(event.usage, model)
			if (usageData) {
				yield usageData
			}
		}
	}

	private getGpt5ReasoningEffort(model: OpenAiNativeModel): ReasoningEffortWithMinimal | undefined {
		const { reasoning, info } = model

		// Check if reasoning effort is configured
		if (reasoning && "reasoning_effort" in reasoning) {
			const effort = reasoning.reasoning_effort as string
			// Support all effort levels including "minimal" for GPT-5
			if (effort === "minimal" || effort === "low" || effort === "medium" || effort === "high") {
				return effort as ReasoningEffortWithMinimal
			}
		}

		// Centralize default: use the model's default from types if available; otherwise undefined
		return info.reasoningEffort as ReasoningEffortWithMinimal | undefined
	}

	private isGpt5Model(modelId: string): boolean {
		return modelId.startsWith("gpt-5")
	}

	private isResponsesApiModel(modelId: string): boolean {
		// Both GPT-5 and Codex Mini use the v1/responses endpoint
		return modelId.startsWith("gpt-5") || modelId === "codex-mini-latest"
	}

	private async *handleStreamResponse(
		stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
		model: OpenAiNativeModel,
	): ApiStream {
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0

		// Extract cache tokens from prompt_tokens_details
		// According to OpenAI API, cached_tokens represents tokens read from cache
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || undefined

		// Cache write tokens are not typically reported in the standard streaming response
		// They would be in cache_creation_input_tokens if available
		const cacheWriteTokens = (usage as any)?.cache_creation_input_tokens || undefined

		const totalCost = calculateApiCostOpenAI(
			info,
			inputTokens,
			outputTokens,
			cacheWriteTokens || 0,
			cacheReadTokens || 0,
		)

		yield {
			type: "usage",
			inputTokens: inputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	override getModel() {
		const modelId = this.options.apiModelId

		let id =
			modelId && modelId in openAiNativeModels ? (modelId as OpenAiNativeModelId) : openAiNativeDefaultModelId

		const info: ModelInfo = openAiNativeModels[id]

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: this.isGpt5Model(id) ? GPT5_DEFAULT_TEMPERATURE : OPENAI_NATIVE_DEFAULT_TEMPERATURE,
		})

		// For models using the Responses API (GPT-5 and Codex Mini), ensure we support reasoning effort
		if (this.isResponsesApiModel(id)) {
			const effort =
				(this.options.reasoningEffort as ReasoningEffortWithMinimal | undefined) ??
				(info.reasoningEffort as ReasoningEffortWithMinimal | undefined)

			if (effort) {
				;(params.reasoning as any) = { reasoning_effort: effort }
			}
		}

		// The o3 models are named like "o3-mini-[reasoning-effort]", which are
		// not valid model ids, so we need to strip the suffix.
		return { id: id.startsWith("o3-mini") ? "o3-mini" : id, info, ...params, verbosity: params.verbosity }
	}

	/**
	 * Gets the last GPT-5 response ID captured from the Responses API stream.
	 * Used for maintaining conversation continuity across requests.
	 * @returns The response ID, or undefined if not available yet
	 */
	getLastResponseId(): string | undefined {
		return this.lastResponseId
	}

	/**
	 * Sets the last GPT-5 response ID for conversation continuity.
	 * Typically only used in tests or special flows.
	 * @param responseId The GPT-5 response ID to store
	 */
	setResponseId(responseId: string): void {
		this.lastResponseId = responseId
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const { id, temperature, reasoning, verbosity } = this.getModel()
			const isResponsesApi = this.isResponsesApiModel(id)

			if (isResponsesApi) {
				// Models that use the Responses API (GPT-5 and Codex Mini) don't support non-streaming completion
				throw new Error(`completePrompt is not supported for ${id}. Use createMessage (Responses API) instead.`)
			}

			const params: any = {
				model: id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add temperature if supported
			if (temperature !== undefined) {
				params.temperature = temperature
			}

			// Add reasoning parameters for models that support them
			if (reasoning) {
				Object.assign(params, reasoning)
			}

			const response = await this.client.chat.completions.create(params)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`OpenAI Native completion error: ${error.message}`)
			}
			throw error
		}
	}
}
