import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import {
    ApiHandlerOptions,
    ModelInfo,
    nebulaBlockDefaultModelId,
    NebulaBlockModelId,
    nebulaBlockModels,
} from "../../shared/api"
import { withRetry } from "../retry"
import { ApiStream } from "../transform/stream"
import { calculateApiCostOpenAI } from "../../utils/cost"

export class NebulaBlockHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client: OpenAI

    constructor(options: ApiHandlerOptions) {
        this.options = options
        this.client = new OpenAI({
            baseURL: "https://inference.nebulablock.com/v1",
            apiKey: this.options.nebulaBlockApiKey,
            defaultHeaders: {
                "HTTP-Referer": "https://cline.bot",
                "X-Title": "Cline",
            },
        })
    }

    @withRetry()
    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
        const model = this.getModel()
        const stream = await this.client.chat.completions.create({
            model: model.id,
            messages: [
                { role: "system" as const, content: systemPrompt },
                ...messages.map(msg => ({
                    role: msg.role === "user" ? "user" as const : "assistant" as const,
                    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
                }))
            ],
            max_tokens: undefined,
            temperature: 1,
            top_p: 0.9,
            stream: true
        })

        let didOutputUsage: boolean = false

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta
            if (delta?.content) {
                yield {
                    type: "text",
                    text: delta.content,
                }
            }

            if (!didOutputUsage && chunk.usage) {
                const inputTokens = chunk.usage.prompt_tokens || 0
                const outputTokens = chunk.usage.completion_tokens || 0
                yield {
                    type: "usage",
                    inputTokens: inputTokens,
                    outputTokens: outputTokens,
                    totalCost: calculateApiCostOpenAI(model.info, inputTokens, outputTokens),
                }
                didOutputUsage = true
            }
        }
    }

    getModel(): { id: NebulaBlockModelId; info: ModelInfo } {
        const modelId = this.options.apiModelId
        if (modelId && modelId in nebulaBlockModels) {
            const id = modelId as NebulaBlockModelId
            return { id, info: nebulaBlockModels[id] }
        }
        return {
            id: nebulaBlockDefaultModelId,
            info: nebulaBlockModels[nebulaBlockDefaultModelId],
        }
    }
} 