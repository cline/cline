import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import { withRetry } from "../retry"
import { ApiHandlerOptions, azureOpenAiDefaultApiVersion, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"

function getUtf8ByteLength(text: string): number {
	if (!text) {
		return 0
	}
	return new TextEncoder().encode(text).length
}

function estimateTokensFromBytes(byteLength: number): number {
	const bytesPerTokenRatio = 4 // Tune this ratio through testing
	return Math.ceil(byteLength / bytesPerTokenRatio)
}

function estimateInputTextTokens(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): number {
	let combinedInputText = systemPrompt + "\n" // Start with system prompt
	for (const message of messages) {
		combinedInputText += `${message.role}: ${message.content}\n` // Add role and content for each message
	}
	const byteLength = getUtf8ByteLength(combinedInputText)
	return estimateTokensFromBytes(byteLength)
}

export class OpenAiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		// Azure API shape slightly differs from the core API shape: https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
		if (this.options.openAiBaseUrl?.toLowerCase().includes("azure.com")) {
			this.client = new AzureOpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
			})
		} else {
			this.client = new OpenAI({
				baseURL: this.options.openAiBaseUrl,
				apiKey: this.options.openAiApiKey,
			})
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.options.openAiModelId ?? ""
		const isDeepseekReasoner = modelId.includes("deepseek-reasoner")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const estimatedInputTokens = estimateInputTextTokens(systemPrompt, messages) // Estimate input tokens BEFORE API call
		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

		let estimatedOutputTokens = 0 // Keep track of estimated output tokens
		let apiUsageReceived = false // Flag to track if API usage is received

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta || {} // Safe access with default empty object

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
				// API Usage is available, use actual values
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
				estimatedOutputTokens = 0 // Reset estimated output tokens as we have real values now
				apiUsageReceived = true // Set the flag to true
			} else {
				// API Usage is NOT available, estimate output tokens
				if (delta?.content) {
					const byteLength = getUtf8ByteLength(delta.content)
					const chunkEstimatedOutputTokens = estimateTokensFromBytes(byteLength)
					estimatedOutputTokens += chunkEstimatedOutputTokens // Accumulate estimated tokens
				}
			}
		}

		// After the stream is finished, check if API usage was ever received
		if (!apiUsageReceived) {
			yield {
				type: "usage",
				inputTokens: estimatedInputTokens, // Yield the pre-calculated estimated input tokens
				outputTokens: estimatedOutputTokens, // Yield the final accumulated estimated output tokens
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
