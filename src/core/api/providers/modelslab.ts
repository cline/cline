import { ModelInfo, modelsLabDefaultModelId, modelsLabModels, ModelsLabModelId } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

const MODELSLAB_BASE_URL = "https://modelslab.com/api/uncensored-chat/v1"

interface ModelsLabHandlerOptions extends CommonApiHandlerOptions {
	modelsLabApiKey?: string
	modelsLabModelId?: string
}

/**
 * ModelsLabHandler — OpenAI-compatible handler for ModelsLab's uncensored LLM API.
 *
 * ModelsLab (https://modelslab.com) provides an OpenAI-compatible chat endpoint
 * for uncensored Llama-based models with 128K context windows.  This handler
 * is implemented exactly like the Fireworks and Together handlers — no extra
 * dependencies required.
 *
 * Supported models
 * ----------------
 * See `modelsLabModels` in src/shared/api.ts for the full list.
 * Default: llama-3.1-8b-uncensored
 *
 * Configuration
 * -------------
 * API key: MODELSLAB_API_KEY env var  (or set via Cline settings UI)
 * Model:   modelsLabModelId option    (or set via Cline settings UI)
 */
export class ModelsLabHandler implements ApiHandler {
	private options: ModelsLabHandlerOptions
	private client: OpenAI | undefined

	constructor(options: ModelsLabHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.modelsLabApiKey) {
				throw new Error(
					"ModelsLab API key is required. " +
						"Set it in Cline settings or the MODELSLAB_API_KEY environment variable. " +
						"Get your key at https://modelslab.com/api-keys",
				)
			}
			try {
				this.client = createOpenAIClient({
					baseURL: MODELSLAB_BASE_URL,
					apiKey: this.options.modelsLabApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating ModelsLab client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.modelsLabModelId ?? modelsLabDefaultModelId

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
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

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = (this.options.modelsLabModelId ?? modelsLabDefaultModelId) as ModelsLabModelId
		const info = modelsLabModels[modelId] ?? modelsLabModels[modelsLabDefaultModelId]
		return { id: modelId, info }
	}
}
