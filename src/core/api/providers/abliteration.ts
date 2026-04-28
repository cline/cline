import { AbliterationModelId, abliterationDefaultModelId, abliterationModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface AbliterationHandlerOptions extends CommonApiHandlerOptions {
	abliterationApiKey?: string
	apiModelId?: string
}

export class AbliterationHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: AbliterationHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.abliterationApiKey) {
				throw new Error("Abliteration API key is required")
			}

			try {
				this.client = createOpenAIClient({
					baseURL: "https://api.abliteration.ai/v1",
					apiKey: this.options.abliterationApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating Abliteration client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const toolCallProcessor = new ToolCallProcessor()

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			temperature: model.info.temperature,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
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
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				const inputTokens = chunk.usage.prompt_tokens || 0
				const outputTokens = chunk.usage.completion_tokens || 0

				yield {
					type: "usage",
					inputTokens,
					outputTokens,
					totalCost: calculateApiCostOpenAI(model.info, inputTokens, outputTokens),
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId

		if (modelId !== undefined && modelId in abliterationModels) {
			return { id: modelId, info: abliterationModels[modelId as AbliterationModelId] }
		}

		return {
			id: abliterationDefaultModelId,
			info: abliterationModels[abliterationDefaultModelId],
		}
	}

	supportsImages(): boolean {
		return this.getModel().info.supportsImages === true
	}

	supportsTools(): boolean {
		return true
	}
}
