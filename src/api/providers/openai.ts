import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import { withRetry } from "../retry"
import { ApiHandlerOptions, azureOpenAiDefaultApiVersion, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"

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

	private async diagnoseRequestProblem(
		modelId: string,
		messages: OpenAI.Chat.ChatCompletionMessageParam[],
		apiKey: string,
		baseURL: string,
	) {
		const url = `${baseURL}/chat/completions`

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: modelId,
					messages: messages,
					temperature: 0,
					stream: true,
				}),
			})

			if (!response.ok) {
				return `HTTP error! status: ${response.status}, statusText: ${response.statusText}`
			}

			const responseData = await response.json()
			return responseData
		} catch (error) {
			return error instanceof Error ? error.message : String(error)
		}
	}

	private async *handleChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): ApiStream {
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

		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

		const [validationStream, contentStream] = stream.tee()

		// Check the first chunk to detect potential stream issues early
		// This helps to provide better error messages for cases like:
		// https://github.com/cline/cline/issues/1662
		// where the stream appears valid but contains no actual data
		const firstChunk = await validationStream[Symbol.asyncIterator]().next()
		if (firstChunk.done || !firstChunk.value) {
			// Make an additional request to get detailed error information
			// This gives us more context about what went wrong with the API call
			const errorResponse = await this.diagnoseRequestProblem(
				modelId,
				openAiMessages,
				this.client.apiKey,
				this.client.baseURL,
			)
			throw new Error(`Stream empty. Error details: ${JSON.stringify(errorResponse)}`)
		}

		yield* this.handleChunk(firstChunk.value)

		for await (const chunk of contentStream) {
			yield* this.handleChunk(chunk)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.openAiModelId ?? "",
			info: this.options.openAiModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
