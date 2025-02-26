import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"

import {
	ApiHandlerOptions,
	azureOpenAiDefaultApiVersion,
	ModelInfo,
	openAiModelInfoSaneDefaults,
} from "../../shared/api"
import { ApiHandler, SingleCompletionHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { convertToSimpleMessages } from "../transform/simple-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"

export interface OpenAiHandlerOptions extends ApiHandlerOptions {
	defaultHeaders?: Record<string, string>
}

export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.6
const OPENAI_DEFAULT_TEMPERATURE = 0

export class OpenAiHandler implements ApiHandler, SingleCompletionHandler {
	protected options: OpenAiHandlerOptions
	private client: OpenAI

	constructor(options: OpenAiHandlerOptions) {
		this.options = options

		const baseURL = this.options.openAiBaseUrl ?? "https://api.openai.com/v1"
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		let urlHost: string

		try {
			urlHost = new URL(this.options.openAiBaseUrl ?? "").host
		} catch (error) {
			// Likely an invalid `openAiBaseUrl`; we're still working on
			// proper settings validation.
			urlHost = ""
		}

		if (urlHost === "azure.com" || urlHost.endsWith(".azure.com") || options.openAiUseAzure) {
			// Azure API shape slightly differs from the core API shape:
			// https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
			this.client = new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
			})
		} else {
			this.client = new OpenAI({ baseURL, apiKey, defaultHeaders: this.options.defaultHeaders })
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelInfo = this.getModel().info
		const modelUrl = this.options.openAiBaseUrl ?? ""
		const modelId = this.options.openAiModelId ?? ""

		const deepseekReasoner = modelId.includes("deepseek-reasoner")
		const ark = modelUrl.includes(".volces.com")

		if (this.options.openAiStreamingEnabled ?? true) {
			const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
				role: "system",
				content: systemPrompt,
			}

			let convertedMessages
			if (deepseekReasoner) {
				convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			} else if (ark) {
				convertedMessages = [systemMessage, ...convertToSimpleMessages(messages)]
			} else {
				convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]
			}

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				temperature:
					this.options.modelTemperature ??
					(deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : OPENAI_DEFAULT_TEMPERATURE),
				messages: convertedMessages,
				stream: true as const,
				stream_options: { include_usage: true },
			}
			if (this.options.includeMaxTokens) {
				requestOptions.max_tokens = modelInfo.maxTokens
			}

			const stream = await this.client.chat.completions.create(requestOptions)

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta ?? {}

				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				if ("reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						text: (delta.reasoning_content as string | undefined) || "",
					}
				}
				if (chunk.usage) {
					yield this.processUsageMetrics(chunk.usage)
				}
			}
		} else {
			// o1 for instance doesnt support streaming, non-1 temp, or system prompt
			const systemMessage: OpenAI.Chat.ChatCompletionUserMessageParam = {
				role: "user",
				content: systemPrompt,
			}

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: deepseekReasoner
					? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
					: [systemMessage, ...convertToOpenAiMessages(messages)],
			}

			const response = await this.client.chat.completions.create(requestOptions)

			yield {
				type: "text",
				text: response.choices[0]?.message.content || "",
			}
			yield this.processUsageMetrics(response.usage)
		}
	}

	protected processUsageMetrics(usage: any): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: this.getModel().id,
				messages: [{ role: "user", content: prompt }],
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`OpenAI completion error: ${error.message}`)
			}
			throw error
		}
	}
}

export async function getOpenAiModels(baseUrl?: string, apiKey?: string) {
	try {
		if (!baseUrl) {
			return []
		}

		if (!URL.canParse(baseUrl)) {
			return []
		}

		const config: Record<string, any> = {}

		if (apiKey) {
			config["headers"] = { Authorization: `Bearer ${apiKey}` }
		}

		const response = await axios.get(`${baseUrl}/models`, config)
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		return []
	}
}
