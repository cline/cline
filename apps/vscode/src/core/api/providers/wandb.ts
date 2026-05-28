import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { type ModelInfo, openAiModelInfoSafeDefaults, type WandbModelId } from "@shared/api"
import { getProviderModelFromSdk } from "@shared/sdk-handler-models"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface WandbHandlerOptions extends CommonApiHandlerOptions {
	wandbApiKey?: string
	apiModelId?: string
}

export class WandbHandler implements ApiHandler {
	private client: OpenAI | undefined

	constructor(private readonly options: WandbHandlerOptions) {}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.wandbApiKey) {
				throw new Error("W&B API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://api.inference.wandb.ai/v1",
					apiKey: this.options.wandbApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating W&B Inference client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		const stream = await client.chat.completions.create({
			model: model.id,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				// W&B Inference returns prompt_tokens_details.cached_tokens in the usage chunk,
				// but does not currently offer cache-aware billing (cached tokens are billed
				// at the same rate as regular input tokens). We report inputTokens as the full
				// prompt_tokens value and do not subtract cached tokens until W&B supports
				// cache-aware pricing. This may change in a future update.
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId?.trim()
		const wandbCollection = MODEL_COLLECTIONS_BY_PROVIDER_ID["wandb"]

		// Custom id not in the SDK catalog: let it through with safe
		// defaults. wandb hosts a wide range of model ids the SDK doesn't
		// enumerate, so we trust the user-supplied value rather than
		// snapping to the default.
		if (modelId && wandbCollection && !(modelId in wandbCollection.models)) {
			return { id: modelId, info: openAiModelInfoSafeDefaults }
		}

		return getProviderModelFromSdk<WandbModelId>("wandb", modelId)
	}
}
