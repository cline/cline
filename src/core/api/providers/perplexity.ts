import { ModelInfo, PerplexityModelId, perplexityDefaultModelId, perplexityModels } from "@shared/api"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { version as extensionVersion } from "../../../../package.json"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface PerplexityHandlerOptions extends CommonApiHandlerOptions {
	perplexityApiKey?: string
	perplexityModelId?: string
}

// Perplexity's Agent API lives under /v1 and exposes a multi-provider
// model catalogue (OpenAI, Anthropic, Google, xAI, NVIDIA, Perplexity
// Sonar) through the OpenAI-compatible /v1/chat/completions endpoint.
// See https://docs.perplexity.ai/docs/agent-api/quickstart.
const PERPLEXITY_BASE_URL = "https://api.perplexity.ai/v1"

function resolvePerplexityApiKey(explicit?: string): string | undefined {
	if (explicit) {
		return explicit
	}
	const fromEnv = process.env.PERPLEXITY_API_KEY || process.env.PPLX_API_KEY || undefined
	return fromEnv
}

export class PerplexityHandler implements ApiHandler {
	private options: PerplexityHandlerOptions
	private client: OpenAI | undefined

	constructor(options: PerplexityHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			const apiKey = resolvePerplexityApiKey(this.options.perplexityApiKey)
			if (!apiKey) {
				throw new Error("Perplexity API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: PERPLEXITY_BASE_URL,
					apiKey,
					defaultHeaders: {
						"X-Pplx-Integration": `cline/${extensionVersion}`,
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Perplexity client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const { id: modelId, info: modelInfo } = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// The Agent API surfaces many heterogeneous upstream models; reasoning
		// models (Claude, Gemini, Grok reasoning, etc.) don't accept temperature=0
		// in the OpenAI-compatible shim, so omit it for any reasoning-capable model.
		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(modelInfo.supportsReasoning ? {} : { temperature: 0 }),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta as
				| (OpenAI.Chat.Completions.ChatCompletionChunk["choices"][number]["delta"] & {
						reasoning_content?: string
						reasoning?: string
				  })
				| undefined

			// Perplexity's Agent API normalizes reasoning under either
			// `reasoning_content` (Sonar / OpenAI-style) or `reasoning`
			// (Anthropic / Gemini / Grok-style). Accept both.
			const reasoningChunk = delta?.reasoning_content ?? delta?.reasoning
			if (reasoningChunk) {
				yield {
					type: "reasoning",
					reasoning: reasoningChunk,
				}
			}

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
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

	getModel(): { id: PerplexityModelId; info: ModelInfo } {
		const modelId = this.options.perplexityModelId
		if (modelId && modelId in perplexityModels) {
			const id = modelId as PerplexityModelId
			return { id, info: perplexityModels[id] }
		}
		return {
			id: perplexityDefaultModelId,
			info: perplexityModels[perplexityDefaultModelId],
		}
	}
}
