import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import axios from "axios"

import { ApiHandler, SingleCompletionHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { DEEP_SEEK_DEFAULT_TEMPERATURE } from "./openai"
import { XmlMatcher } from "../../utils/xml-matcher"

const OLLAMA_DEFAULT_TEMPERATURE = 0

export class OllamaHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: (this.options.ollamaBaseUrl || "http://localhost:11434") + "/v1",
			apiKey: "ollama",
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.getModel().id
		const useR1Format = modelId.toLowerCase().includes("deepseek-r1")
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...(useR1Format ? convertToR1Format(messages) : convertToOpenAiMessages(messages)),
		]

		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			messages: openAiMessages,
			temperature: this.options.modelTemperature ?? OLLAMA_DEFAULT_TEMPERATURE,
			stream: true,
		})
		const matcher = new XmlMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta

			if (delta?.content) {
				for (const chunk of matcher.update(delta.content)) {
					yield chunk
				}
			}
		}
		for (const chunk of matcher.final()) {
			yield chunk
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.ollamaModelId || "",
			info: openAiModelInfoSaneDefaults,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const modelId = this.getModel().id
			const useR1Format = modelId.toLowerCase().includes("deepseek-r1")
			const response = await this.client.chat.completions.create({
				model: this.getModel().id,
				messages: useR1Format
					? convertToR1Format([{ role: "user", content: prompt }])
					: [{ role: "user", content: prompt }],
				temperature:
					this.options.modelTemperature ??
					(useR1Format ? DEEP_SEEK_DEFAULT_TEMPERATURE : OLLAMA_DEFAULT_TEMPERATURE),
				stream: false,
			})
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Ollama completion error: ${error.message}`)
			}
			throw error
		}
	}
}

export async function getOllamaModels(baseUrl = "http://localhost:11434") {
	try {
		if (!URL.canParse(baseUrl)) {
			return []
		}

		const response = await axios.get(`${baseUrl}/api/tags`)
		const modelsArray = response.data?.models?.map((model: any) => model.name) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		return []
	}
}
