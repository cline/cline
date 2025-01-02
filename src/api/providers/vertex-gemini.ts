import { ApiHandler } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	VertexGeminiModelId,
	vertexGeminiDefaultModelId,
	vertexGeminiModels,
} from "../../shared/api"
import { VertexAI, GenerativeModel, Content } from "@google-cloud/vertexai"
import { ApiStream } from "../transform/stream"
import { Anthropic } from "@anthropic-ai/sdk"
import { convertAnthropicMessageToVertexGemini } from "../transform/gemini-format"

export class VertexGeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private vertexAi: VertexAI
	private model: GenerativeModel

	constructor(options: ApiHandlerOptions) {
		this.options = options
		if (!this.options.vertexRegion) {
			throw new Error("Vertex Region is required")
		}
		this.vertexAi = new VertexAI({
			project: this.options.vertexProjectId || "",
			location: this.options.vertexRegion,
		})
		this.model = this.vertexAi.getGenerativeModel({
			model: this.getModel().id,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Add system prompt as a user message at the start if provided
		const contents: Content[] = []
		if (systemPrompt) {
			contents.push({
				role: "user",
				parts: [{ text: systemPrompt }],
			})
		}

		// Convert and add the rest of the messages
		contents.push(...messages.map(convertAnthropicMessageToVertexGemini))

		const result = await this.model.generateContentStream({ contents })

		let totalOutputTokens = 0

		for await (const chunk of result.stream) {
			if (chunk.candidates?.[0]?.content?.parts) {
				for (const part of chunk.candidates[0].content.parts) {
					if (part.text) {
						totalOutputTokens += part.text.split(/\s+/).length // Rough token count estimation
						yield {
							type: "text",
							text: part.text,
						}
					}
				}
			}
		}

		// Yield usage information at the end
		yield {
			type: "usage",
			inputTokens: contents.reduce(
				(acc, content) =>
					acc + content.parts.reduce((partAcc, part) => partAcc + (part.text?.split(/\s+/).length || 0), 0),
				0,
			),
			outputTokens: totalOutputTokens,
		}
	}
	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId as VertexGeminiModelId
		if (modelId && vertexGeminiModels[modelId]) {
			return { id: modelId, info: vertexGeminiModels[modelId] }
		}
		return {
			id: vertexGeminiDefaultModelId,
			info: vertexGeminiModels[vertexGeminiDefaultModelId],
		}
	}
}
