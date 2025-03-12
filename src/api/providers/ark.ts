import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandlerOptions, arkDefaultModelId, ArkModelId, arkModels, ModelInfo } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

type ContentPartText = OpenAI.Chat.ChatCompletionContentPartText
type ContentPartImage = Anthropic.Messages.ImageBlockParam

export class VolcArkHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: this.options.arkBaseUrl,
			apiKey: this.options.arkApiKey,
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const epId = this.options.arkEpId || ""
		const modelId = this.options.apiModelId || ""

		const preConvertMessages = this.prevConvertMessages(messages)

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(preConvertMessages),
		]

		const stream = await this.client.chat.completions.create({
			model: epId || modelId,
			messages: openAiMessages,
			temperature: 0,
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

	// merge part text message to string and convert image_url
	prevConvertMessages(anthropicMessages: Anthropic.Messages.MessageParam[]) {
		for (const anthropicMessage of anthropicMessages) {
			let messageContent = anthropicMessage.content
			// Convert content to appropriate format
			if (Array.isArray(anthropicMessage.content)) {
				const textParts: string[] = []
				const imageParts: ContentPartImage[] = []
				let hasImages = false

				anthropicMessage.content.forEach((part) => {
					if (part.type === "text") {
						textParts.push(part.text)
					}
					if (part.type === "image") {
						hasImages = true
						imageParts.push(part)
					}
				})

				if (hasImages) {
					const parts: (ContentPartText | ContentPartImage)[] = []
					if (textParts.length > 0) {
						parts.push({ type: "text", text: textParts.join("\n") })
					}
					parts.push(...imageParts)
					messageContent = parts
				} else {
					messageContent = textParts.join("\n")
				}
			} else {
				messageContent = anthropicMessage.content
			}
			anthropicMessage.content = messageContent
		}
		return anthropicMessages
	}

	getModel(): { id: ArkModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in arkModels) {
			const id = modelId as ArkModelId
			return { id, info: arkModels[id] }
		}
		return {
			id: arkDefaultModelId,
			info: arkModels[arkDefaultModelId],
		}
	}
}
