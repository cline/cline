import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, bitdeeraiModelId, ModelInfo, bitdeeraiDefaultModelId, bitdeeraiModels } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { convertToR1Format } from "../transform/r1-format"

export class BitdeerAIHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api-inference.bitdeer.ai/v1",
			apiKey: this.options.bitdeeraiApiKey,
		})
	}
	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const isDeepseekReasoner = model.id.includes("DeepSeek-R1")
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}
		/*
		console.log('[BitdeerAI] Request Model:', model.id);
		console.log('[BitdeerAI] Request Messages:', JSON.stringify(openAiMessages, null, 2));
		console.log('[BitdeerAI] API Endpoint:', this.client.baseURL);
		console.log('[BitdeerAI] Request Headers:', JSON.stringify({
			'Content-Type': 'application/json',
			Authorization: 'Bearer ***REDACTED***'
		}, null, 2));
*/
		const stream = await this.client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(model.id === "deepseek-ai/DeepSeek-R1" ? {} : { temperature: 0 }),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}
			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
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

	getModel(): { id: bitdeeraiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bitdeeraiModels) {
			const id = modelId as bitdeeraiModelId
			return { id, info: bitdeeraiModels[id] }
		}
		return {
			id: bitdeeraiDefaultModelId,
			info: bitdeeraiModels[bitdeeraiDefaultModelId],
		}
	}
}
