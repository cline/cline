import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import axios from "axios"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class OllamaHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private modelInfo: ModelInfo = openAiModelInfoSaneDefaults
	private modelInfoPromise: Promise<void> | null = null

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: (this.options.ollamaBaseUrl || "http://localhost:11434") + "/v1",
			apiKey: "ollama",
		})
		// Start fetching model info immediately
		this.modelInfoPromise = this.fetchModelInfo()
	}

	private async fetchModelInfo(): Promise<void> {
		try {
			const modelId = this.options.ollamaModelId || ""
			const baseUrl = this.options.ollamaBaseUrl || "http://localhost:11434"
			const response = await axios.post(`${baseUrl}/api/show`, {
				name: modelId
			})
			
			const modelInfo = response.data?.model_info
			let contextLength = openAiModelInfoSaneDefaults.contextWindow

			// Find any property that ends with .context_length
			if (modelInfo) {
				const contextLengthKey = Object.keys(modelInfo).find(key => key.endsWith('.context_length'))
				if (contextLengthKey) {
					contextLength = modelInfo[contextLengthKey]
				}
			}

			// Get max tokens from num_ctx parameter
			const maxTokens = response.data?.parameters?.num_ctx ? 
				parseInt(response.data.parameters.num_ctx) : 
				openAiModelInfoSaneDefaults.maxTokens

			this.modelInfo = {
				...openAiModelInfoSaneDefaults,
				contextWindow: contextLength,
				maxTokens,
			}
		} catch (error) {
			console.error("Error fetching Ollama model info:", error)
			this.modelInfo = openAiModelInfoSaneDefaults
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Wait for model info to be fetched before creating message
		if (this.modelInfoPromise) {
			await this.modelInfoPromise
			this.modelInfoPromise = null
		}

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			messages: openAiMessages,
			temperature: 0,
			stream: true,
		})
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.ollamaModelId || "",
			info: this.modelInfo,
		}
	}
}
