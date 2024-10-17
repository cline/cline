import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import delay from "delay"

export class OpenRouterHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client: OpenAI

    constructor(options: ApiHandlerOptions) {
        this.options = options
        this.client = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: this.options.openRouterApiKey,
            defaultHeaders: {
                "HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
                "X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
            },
        })
    }

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
        // Convert Anthropic messages to OpenAI format
        const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            ...convertToOpenAiMessages(messages),
        ]

        // Prompt caching: https://openrouter.ai/docs/prompt-caching
        switch (this.getModel().id) {
            case "anthropic/claude-3.5-sonnet:beta":
            case "anthropic/claude-3-haiku:beta":
            case "anthropic/claude-3-opus:beta":
                openAiMessages[0] = {
                    role: "system",
                    content: [
                        {
                            type: "text",
                            text: systemPrompt,
                            // @ts-ignore-next-line
                            cache_control: { type: "ephemeral" },
                        },
                    ],
                }
                // Add cache_control to the last two user messages
                const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
                lastTwoUserMessages.forEach((msg) => {
                    if (typeof msg.content === "string") {
                        msg.content = [{ type: "text", text: msg.content }]
                    }
                    if (Array.isArray(msg.content)) {
                        let lastTextPart = msg.content.filter((part) => part.type === "text").pop()
                        if (!lastTextPart) {
                            lastTextPart = { type: "text", text: "..." }
                            msg.content.push(lastTextPart)
                        }
                        // @ts-ignore-next-line
                        lastTextPart["cache_control"] = { type: "ephemeral" }
                    }
                })
                break
            default:
                break
        }

        // Ensure max tokens for Anthropic models
        let maxTokens: number | undefined
        switch (this.getModel().id) {
            case "anthropic/claude-3.5-sonnet":
            case "anthropic/claude-3.5-sonnet:beta":
                maxTokens = 8192
                break
            default:
                break
        }

        const stream = await this.client.chat.completions.create({
            model: this.getModel().id,
            max_tokens: maxTokens,
            temperature: 0,
            messages: openAiMessages,
            stream: true,
        })

        let genId: string | undefined

        for await (const chunk of stream) {
            if ("error" in chunk) {
                const error = chunk.error as { message?: string; code?: number }
                console.error(OpenRouter API Error: ${error?.code} - ${error?.message})
                throw new Error(OpenRouter API Error ${error?.code}: ${error?.message})
            }

            if (!genId && chunk.id) {
                genId = chunk.id
            }

            yield chunk
        }
    }

    getModel(): { id: string; info: ModelInfo } {
        const modelId = this.options.openRouterModelId
        const modelInfo = this.options.openRouterModelInfo

        if (modelId && modelInfo) {
            return { id: modelId, info: modelInfo }
        }

        return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
    }
}
