// src/providers/targon-handler.ts
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, targonModels, targonDefaultModelId, TargonModelId } from "../../shared/api"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream } from "../transform/stream"

export class TargonHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.targon.ai/v1", 
			apiKey: this.options.targonApiKey,   
		})
	}

    // should we put anthropic format as message
	async *createMessage(systemPrompt: string, messages: any[]): ApiStream {
		const stream = await createOpenRouterStream(
			this.client,
			systemPrompt,
			messages,
			this.getModel(),
		)

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

    getModel(): { id: TargonModelId; info: ModelInfo } {
        const modelId = (this.options.apiModelId || targonDefaultModelId) as TargonModelId
        const modelInfo = targonModels[modelId]
    
        return {
            id: modelId,
            info: modelInfo,
        }
    }
}
