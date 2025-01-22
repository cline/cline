import { ApiHandlerOptions, unboundModels, UnboundModelId, unboundDefaultModelId, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../index"

export class UnboundHandler implements ApiHandler {
	private unboundApiKey: string
	private unboundModelId: string
	private unboundBaseUrl: string = "https://ai-gateway-43843357113.us-west1.run.app/v1"
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.unboundApiKey = options.unboundApiKey || ""
		this.unboundModelId = options.unboundModelId || ""
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const response = await fetch(`${this.unboundBaseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.unboundApiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: this.unboundModelId,
				messages: [{ role: "system", content: systemPrompt }, ...messages],
			}),
		})

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`)
		}

		const data = await response.json()

		yield {
			type: "text",
			text: data.choices[0]?.message?.content || "",
		}
		yield {
			type: "usage",
			inputTokens: data.usage?.prompt_tokens || 0,
			outputTokens: data.usage?.completion_tokens || 0,
		}
	}

	getModel(): { id: UnboundModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in unboundModels) {
			const id = modelId as UnboundModelId
			return { id, info: unboundModels[id] }
		}
		return {
			id: unboundDefaultModelId,
			info: unboundModels[unboundDefaultModelId],
		}
	}
}
