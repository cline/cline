import { ApiHandler, CommonApiHandlerOptions } from "@core/api"
import { withRetry } from "@core/api/retry"
import { convertToOpenAiMessages } from "@core/api/transform/openai-format"
import { ApiStream } from "@core/api/transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "@core/api/transform/tool-call-processor"
import type { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"

interface ConstructoryHandlerOptions extends CommonApiHandlerOptions {
	apiModelId?: string
	ulid?: string
}

export class ConstructoryHandler implements ApiHandler {
	private options: ConstructoryHandlerOptions
	private client: OpenAI | undefined

	constructor(options: ConstructoryHandlerOptions) {
		this.options = options
		const baseURL = process.env.RESEARCH_API_SERVER ?? "https://stage-constructor.dev"
		if (!baseURL) {
			throw new Error("RESEARCH_API_SERVER environment variable is required")
		}
		// OpenAI client will append /chat/completions to baseURL, so we need to use the base path only
		const fullBaseURL = `${baseURL}/api/platform-kmapi/v1/directllm`

		this.client = new OpenAI({
			baseURL: fullBaseURL,
			apiKey: "noop",
			defaultHeaders: {
				"X-CTR-Session-Token": process.env.RESEARCH_SDK_TOKEN ?? "KL5ISS6O2R7B0SP9HU1CECUVZ5GMY746",
			},
			fetch, // Use configured fetch with proxy support
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = this.client!
		const modelId = this.options.apiModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const toolCallProcessor = new ToolCallProcessor()

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			...getOpenAIToolParams(tools),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.apiModelId ?? "",
			info: {
				maxTokens: 8192,
				supportsPromptCache: false,
			},
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const client = this.client!
		const modelId = this.options.apiModelId ?? ""

		const response = await client.chat.completions.create({
			model: modelId,
			messages: [{ role: "user", content: prompt }],
			temperature: 0,
		})

		return response.choices[0]?.message?.content ?? ""
	}
}
