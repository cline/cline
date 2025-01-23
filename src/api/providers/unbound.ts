import { ApiHandlerOptions, unboundModels, UnboundModelId, unboundDefaultModelId, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../index"

export class UnboundHandler implements ApiHandler {
	private unboundBaseUrl: string = "https://ai-gateway-43843357113.us-west1.run.app/v1"
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		try {
			const response = await fetch(`${this.unboundBaseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.options.unboundApiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: this.getModel().id,
					messages: [{ role: "system", content: systemPrompt }, ...messages],
				}),
			})

			const data = await response.json()

			if (!response.ok) {
				throw new Error(data.error)
			}

			yield {
				type: "text",
				text: data.choices[0]?.message?.content || "",
			}
			yield {
				type: "usage",
				inputTokens: data.usage?.prompt_tokens || 0,
				outputTokens: data.usage?.completion_tokens || 0,
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Unbound Gateway completion error: ${error.message}`)
			}
			throw error
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
