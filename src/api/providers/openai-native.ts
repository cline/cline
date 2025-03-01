import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	openAiNativeDefaultModelId,
	OpenAiNativeModelId,
	openAiNativeModels,
} from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { ApiStream } from "../transform/stream"
import { ChatCompletionReasoningEffort } from "openai/resources/chat/completions.mjs"

export class OpenAiNativeHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			apiKey: this.options.openAiNativeApiKey,
		})
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0
		const cacheWriteTokens = 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
		yield {
			type: "usage",
			inputTokens: inputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: cacheWriteTokens,
			cacheReadTokens: cacheReadTokens,
			totalCost: totalCost,
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		switch (this.getModel().id) {
			//o1-series doesnt support streaming, non-1 temp
			case "o1": {
				// o1 suggests changing message role from 'system' to 'developer'
				const response = await this.client.chat.completions.create({
					model: this.getModel().id,
					messages: [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					reasoning_effort: (this.options.oSeriesReasoningEffortLevel as ChatCompletionReasoningEffort) || "medium",
				})
				yield {
					type: "text",
					text: response.choices[0]?.message.content || "",
				}
				yield {
					type: "usage",
					inputTokens: response.usage?.prompt_tokens || 0,
					outputTokens: response.usage?.completion_tokens || 0,
				}
				break
			}
			case "o1-preview":
			case "o1-mini": {
				// o1-preview and o1-mini doesnt support system prompt and 'Reasoning effort'
				const response = await this.client.chat.completions.create({
					model: model.id,
					messages: [{ role: "user", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
				})
				yield {
					type: "text",
					text: response.choices[0]?.message.content || "",
				}

				yield* this.yieldUsage(model.info, response.usage)

				break
			}
			case "o3-mini": {
				// o3-mini suggests changing message role from 'system' to 'developer'
				const stream = await this.client.chat.completions.create({
					model: model.id,
					messages: [{ role: "developer", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
					reasoning_effort: (this.options.oSeriesReasoningEffortLevel as ChatCompletionReasoningEffort) || "medium",
				})
				for await (const chunk of stream) {
					const delta = chunk.choices[0]?.delta
					if (delta?.content) {
						yield {
							type: "text",
							text: delta.content,
						}
					}
					if (chunk.usage) {
						// Only last chunk contains usage
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
				break
			}
			default: {
				const stream = await this.client.chat.completions.create({
					model: model.id,
					// max_completion_tokens: this.getModel().info.maxTokens,
					temperature: 0,
					messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
					stream: true,
					stream_options: { include_usage: true },
				})

				for await (const chunk of stream) {
					const delta = chunk.choices[0]?.delta
					if (delta?.content) {
						yield {
							type: "text",
							text: delta.content,
						}
					}
					if (chunk.usage) {
						// Only last chunk contains usage
						yield* this.yieldUsage(model.info, chunk.usage)
					}
				}
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
