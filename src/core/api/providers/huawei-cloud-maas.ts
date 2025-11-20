import { HuaweiCloudMaasModelId, huaweiCloudMaasDefaultModelId, huaweiCloudMaasModels, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface HuaweiCloudMaaSHandlerOptions extends CommonApiHandlerOptions {
	huaweiCloudMaasApiKey?: string
	huaweiCloudMaasModelId?: string
	huaweiCloudMaasModelInfo?: ModelInfo
}

export class HuaweiCloudMaaSHandler implements ApiHandler {
	private options: HuaweiCloudMaaSHandlerOptions
	private client: OpenAI | undefined
	constructor(options: HuaweiCloudMaaSHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.huaweiCloudMaasApiKey) {
				throw new Error("Huawei Cloud MaaS API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.modelarts-maas.com/v1/",
					apiKey: this.options.huaweiCloudMaasApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating Huawei Cloud MaaS client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: HuaweiCloudMaasModelId; info: ModelInfo } {
		// First priority: huaweiCloudMaasModelId and huaweiCloudMaasModelInfo (like Groq does)
		const huaweiCloudMaasModelId = this.options.huaweiCloudMaasModelId
		const huaweiCloudMaasModelInfo = this.options.huaweiCloudMaasModelInfo
		if (huaweiCloudMaasModelId && huaweiCloudMaasModelInfo) {
			return { id: huaweiCloudMaasModelId as HuaweiCloudMaasModelId, info: huaweiCloudMaasModelInfo }
		}

		// Second priority: huaweiCloudMaasModelId with static model info
		if (huaweiCloudMaasModelId && huaweiCloudMaasModelId in huaweiCloudMaasModels) {
			const id = huaweiCloudMaasModelId as HuaweiCloudMaasModelId
			return { id, info: huaweiCloudMaasModels[id] }
		}

		// Default fallback
		return {
			id: huaweiCloudMaasDefaultModelId,
			info: huaweiCloudMaasModels[huaweiCloudMaasDefaultModelId],
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0,
			...getOpenAIToolParams(tools),
		})

		let reasoning: string | null = null
		let didOutputUsage: boolean = false
		let finalUsage: any = null

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			// Handle reasoning content detection
			if (delta?.content) {
				if (reasoning || delta.content.includes("<think>")) {
					reasoning = (reasoning || "") + delta.content
				} else if (!reasoning) {
					yield {
						type: "text",
						text: delta.content,
					}
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Handle reasoning output
			if (reasoning || (delta && "reasoning_content" in delta && delta.reasoning_content)) {
				const reasoningContent = delta?.content || ((delta as any)?.reasoning_content as string | undefined) || ""
				if (reasoningContent.trim()) {
					yield {
						type: "reasoning",
						reasoning: reasoningContent,
					}
				}

				// Check if reasoning is complete
				if (reasoning?.includes("</think>")) {
					reasoning = null
				}
			}

			// Store usage information for later output
			if (chunk.usage) {
				finalUsage = chunk.usage
			}

			// Output usage when stream is finished
			if (!didOutputUsage && chunk.choices?.[0]?.finish_reason) {
				if (finalUsage) {
					yield {
						type: "usage",
						inputTokens: finalUsage.prompt_tokens || 0,
						outputTokens: finalUsage.completion_tokens || 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
					}
				}
				didOutputUsage = true
			}
		}
	}
}
