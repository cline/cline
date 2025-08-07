import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
	OPENAI_NATIVE_DEFAULT_TEMPERATURE,
	type ReasoningEffort,
	type VerbosityLevel,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { calculateApiCostOpenAI } from "../../shared/cost"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

export type OpenAiNativeModel = ReturnType<OpenAiNativeHandler["getModel"]>

// GPT-5 specific types for Responses API
type ReasoningEffortWithMinimal = ReasoningEffort | "minimal"

interface GPT5ResponsesAPIParams {
	model: string
	input: string
	reasoning?: {
		effort: ReasoningEffortWithMinimal
	}
	text?: {
		verbosity: VerbosityLevel
	}
}

interface GPT5ResponseChunk {
	type: "text" | "reasoning" | "usage"
	text?: string
	reasoning?: string
	usage?: {
		input_tokens: number
		output_tokens: number
		reasoning_tokens?: number
		total_tokens: number
	}
}

export class OpenAiNativeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		this.client = new OpenAI({ baseURL: this.options.openAiNativeBaseUrl, apiKey })
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
		} else if (this.isGpt5Model(model.id)) {
			yield* this.handleGpt5Message(model, systemPrompt, messages)
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

		// Add verbosity if supported (for future GPT-5 models)
		if (verbosity && model.id.startsWith("gpt-5")) {
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

	private async *handleGpt5Message(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		// GPT-5 uses the Responses API, not Chat Completions
		// We need to format the input as a single string combining system prompt and messages
		const formattedInput = this.formatInputForResponsesAPI(systemPrompt, messages)

		// Get reasoning effort, supporting the new "minimal" option for GPT-5
		const reasoningEffort = this.getGpt5ReasoningEffort(model)

		// Get verbosity from model settings, default to "medium" if not specified
		const verbosity = model.verbosity || "medium"

		// Prepare the request parameters for Responses API
		const params: GPT5ResponsesAPIParams = {
			model: model.id,
			input: formattedInput,
			...(reasoningEffort && {
				reasoning: {
					effort: reasoningEffort,
				},
			}),
			text: {
				verbosity: verbosity,
			},
		}

		// Since the OpenAI SDK doesn't yet support the Responses API,
		// we'll make a direct HTTP request
		const response = await this.makeGpt5ResponsesAPIRequest(params, model)

		yield* this.handleGpt5StreamResponse(response, model)
	}

	private formatInputForResponsesAPI(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): string {
		// Format the conversation for the Responses API's single input field
		let formattedInput = `System: ${systemPrompt}\n\n`

		for (const message of messages) {
			const role = message.role === "user" ? "User" : "Assistant"
			const content =
				typeof message.content === "string"
					? message.content
					: message.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ")
			formattedInput += `${role}: ${content}\n\n`
		}

		return formattedInput.trim()
	}

	private getGpt5ReasoningEffort(model: OpenAiNativeModel): ReasoningEffortWithMinimal | undefined {
		const { reasoning } = model

		// Check if reasoning effort is configured
		if (reasoning && "reasoning_effort" in reasoning) {
			const effort = reasoning.reasoning_effort
			// Support the new "minimal" effort level for GPT-5
			if (effort === "low" || effort === "medium" || effort === "high") {
				return effort
			}
		}

		// Default to "minimal" for GPT-5 models when not specified
		// This provides fastest time-to-first-token as per documentation
		return "minimal"
	}

	private async makeGpt5ResponsesAPIRequest(
		params: GPT5ResponsesAPIParams,
		model: OpenAiNativeModel,
	): Promise<AsyncIterable<GPT5ResponseChunk>> {
		// The OpenAI SDK doesn't have direct support for the Responses API yet,
		// but we can access it through the underlying client request method if available.
		// For now, we'll use the Chat Completions API with GPT-5 specific formatting
		// to maintain compatibility while the Responses API SDK support is being added.

		// Convert Responses API params to Chat Completions format
		// GPT-5 models use "developer" role for system messages
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "developer", content: params.input }]

		// Build the request parameters
		const requestParams: any = {
			model: params.model,
			messages,
			stream: true,
			stream_options: { include_usage: true },
		}

		// Add reasoning effort if specified (supporting "minimal" for GPT-5)
		if (params.reasoning?.effort) {
			if (params.reasoning.effort === "minimal") {
				// For minimal effort, we pass "minimal" as the reasoning_effort
				requestParams.reasoning_effort = "minimal"
			} else {
				requestParams.reasoning_effort = params.reasoning.effort
			}
		}

		// Add verbosity control for GPT-5 models
		// According to the docs, Chat Completions API also supports verbosity parameter
		if (params.text?.verbosity) {
			requestParams.verbosity = params.text.verbosity
		}

		const stream = (await this.client.chat.completions.create(
			requestParams,
		)) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

		// Convert the stream to GPT-5 response format
		return this.convertChatStreamToGpt5Format(stream)
	}

	private async *convertChatStreamToGpt5Format(
		stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
	): AsyncIterable<GPT5ResponseChunk> {
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					usage: {
						input_tokens: chunk.usage.prompt_tokens || 0,
						output_tokens: chunk.usage.completion_tokens || 0,
						total_tokens: chunk.usage.total_tokens || 0,
					},
				}
			}
		}
	}

	private async *handleGpt5StreamResponse(
		stream: AsyncIterable<GPT5ResponseChunk>,
		model: OpenAiNativeModel,
	): ApiStream {
		for await (const chunk of stream) {
			if (chunk.type === "text" && chunk.text) {
				yield {
					type: "text",
					text: chunk.text,
				}
			} else if (chunk.type === "usage" && chunk.usage) {
				const inputTokens = chunk.usage.input_tokens
				const outputTokens = chunk.usage.output_tokens
				const cacheReadTokens = 0
				const cacheWriteTokens = 0
				const totalCost = calculateApiCostOpenAI(
					model.info,
					inputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
				)

				yield {
					type: "usage",
					inputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
					totalCost,
				}
			}
		}
	}

	private isGpt5Model(modelId: string): boolean {
		return modelId.startsWith("gpt-5")
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
			defaultTemperature: OPENAI_NATIVE_DEFAULT_TEMPERATURE,
		})

		// For GPT-5 models, ensure we support minimal reasoning effort
		if (this.isGpt5Model(id) && params.reasoning) {
			// Allow "minimal" effort for GPT-5 models
			const effort = this.options.reasoningEffort
			if (effort === "low" || effort === "medium" || effort === "high") {
				params.reasoning.reasoning_effort = effort
			}
		}

		// The o3 models are named like "o3-mini-[reasoning-effort]", which are
		// not valid model ids, so we need to strip the suffix.
		return { id: id.startsWith("o3-mini") ? "o3-mini" : id, info, ...params, verbosity: params.verbosity }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const { id, temperature, reasoning, verbosity } = this.getModel()

			const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
				verbosity?: VerbosityLevel
			} = {
				model: id,
				messages: [{ role: "user", content: prompt }],
				temperature,
				...(reasoning && reasoning),
			}

			// Add verbosity for GPT-5 models
			if (this.isGpt5Model(id) && verbosity) {
				params.verbosity = verbosity
			}

			const response = await this.client.chat.completions.create(params as any)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`OpenAI Native completion error: ${error.message}`)
			}
			throw error
		}
	}
}
