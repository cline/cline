import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { SingleCompletionHandler } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
} from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { calculateApiCostOpenAI } from "../../utils/cost"

const OPENAI_NATIVE_DEFAULT_TEMPERATURE = 0

// Define a type for the model object returned by getModel
export type OpenAiNativeModel = {
	id: OpenAiNativeModelId
	info: ModelInfo
}

export class OpenAiNativeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		const apiKey = this.options.openAiNativeApiKey ?? "not-provided"
		this.client = new OpenAI({ apiKey })
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()

		if (model.id.startsWith("o1")) {
			yield* this.handleO1FamilyMessage(model, systemPrompt, messages)
			return
		}

		if (model.id.startsWith("o3-mini")) {
			yield* this.handleReasonerMessage(model, "o3-mini", systemPrompt, messages)
			return
		}

		if (model.id.startsWith("o3")) {
			yield* this.handleReasonerMessage(model, "o3", systemPrompt, messages)
			return
		}

		if (model.id.startsWith("o4-mini")) {
			yield* this.handleReasonerMessage(model, "o4-mini", systemPrompt, messages)
			return
		}

		yield* this.handleDefaultModelMessage(model, systemPrompt, messages)
	}

	private async *handleO1FamilyMessage(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		// o1 supports developer prompt with formatting
		// o1-preview and o1-mini only support user messages
		const isOriginalO1 = model.id === "o1"
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
		})

		yield* this.handleStreamResponse(response, model)
	}

	private async *handleReasonerMessage(
		model: OpenAiNativeModel,
		family: "o3-mini" | "o3" | "o4-mini",
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
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
			reasoning_effort: this.getModel().info.reasoningEffort,
		})

		yield* this.handleStreamResponse(stream, model)
	}

	private async *handleDefaultModelMessage(
		model: OpenAiNativeModel,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): ApiStream {
		const stream = await this.client.chat.completions.create({
			model: model.id,
			temperature: this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
		})

		yield* this.handleStreamResponse(stream, model)
	}

	private async *yieldResponseData(response: OpenAI.Chat.Completions.ChatCompletion): ApiStream {
		yield {
			type: "text",
			text: response.choices[0]?.message.content || "",
		}
		yield {
			type: "usage",
			inputTokens: response.usage?.prompt_tokens || 0,
			outputTokens: response.usage?.completion_tokens || 0,
		}
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

	override getModel(): OpenAiNativeModel {
		const modelId = this.options.apiModelId
		if (modelId && modelId in openAiNativeModels) {
			const id = modelId as OpenAiNativeModelId
			return { id, info: openAiNativeModels[id] }
		}
		return { id: openAiNativeDefaultModelId, info: openAiNativeModels[openAiNativeDefaultModelId] }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const model = this.getModel()
			let requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

			if (model.id.startsWith("o1")) {
				requestOptions = this.getO1CompletionOptions(model, prompt)
			} else if (model.id.startsWith("o3-mini")) {
				requestOptions = this.getO3CompletionOptions(model, prompt)
			} else {
				requestOptions = this.getDefaultCompletionOptions(model, prompt)
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`OpenAI Native completion error: ${error.message}`)
			}
			throw error
		}
	}

	private getO1CompletionOptions(
		model: OpenAiNativeModel,
		prompt: string,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
		return {
			model: model.id,
			messages: [{ role: "user", content: prompt }],
		}
	}

	private getO3CompletionOptions(
		model: OpenAiNativeModel,
		prompt: string,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
		return {
			model: "o3-mini",
			messages: [{ role: "user", content: prompt }],
			reasoning_effort: this.getModel().info.reasoningEffort,
		}
	}

	private getDefaultCompletionOptions(
		model: OpenAiNativeModel,
		prompt: string,
	): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
		return {
			model: model.id,
			messages: [{ role: "user", content: prompt }],
			temperature: this.options.modelTemperature ?? OPENAI_NATIVE_DEFAULT_TEMPERATURE,
		}
	}
}
