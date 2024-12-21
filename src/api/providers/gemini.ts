import { Anthropic } from "@anthropic-ai/sdk"
import { GoogleGenerativeAI, Tool, SchemaType } from "@google/generative-ai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "../../shared/api"
import { convertAnthropicMessageToGemini, convertGeminiResponseToAnthropic } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenerativeAI

	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		this.client = new GoogleGenerativeAI(options.geminiApiKey)
	}

	private getTools(): Tool[] {
		const modelInfo = this.getModel().info
		if (!modelInfo.supportsComputerUse) {
			return []
		}

		return [{
			functionDeclarations: [{
				name: "browser_action",
				description: "Interact with a Puppeteer-controlled browser",
				parameters: {
					type: SchemaType.OBJECT,
					properties: {
						action: {
							type: SchemaType.STRING,
							description: "The action to perform (launch, click, type, scroll_down, scroll_up, close)"
						},
						url: {
							type: SchemaType.STRING,
							description: "The URL to launch the browser at (for launch action)"
						},
						coordinate: {
							type: SchemaType.STRING,
							description: "The x,y coordinates for click action (e.g. '450,300')"
						},
						text: {
							type: SchemaType.STRING,
							description: "The text to type (for type action)"
						}
					},
					required: ["action"]
				}
			}]
		}]
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const tools = this.getTools()
		const model = this.client.getGenerativeModel({
			model: this.getModel().id,
			generationConfig: {
				temperature: 0,
			},
			tools: tools.length > 0 ? tools : undefined
		})

		const result = await model.generateContentStream({
			contents: messages.map(convertAnthropicMessageToGemini),
			tools: tools.length > 0 ? tools : undefined
		})

		let responseText = ""
		for await (const chunk of result.stream) {
			const text = chunk.text()
			responseText += text
			yield {
				type: "text",
				text,
			}
		}

		const response = await result.response
		const anthropicMessage = convertGeminiResponseToAnthropic(response)

		yield {
			type: "usage",
			inputTokens: anthropicMessage.usage.input_tokens,
			outputTokens: anthropicMessage.usage.output_tokens,
		}
	}

	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return { id: geminiDefaultModelId, info: geminiModels[geminiDefaultModelId] }
	}
}
