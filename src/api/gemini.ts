import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, withoutImageData } from "."
import {
    ApiHandlerOptions,
    ModelInfo,
    geminiDefaultModelId,
    GeminiModelId,
    geminiModels,
} from "../shared/api"
import { GoogleGenerativeAI } from "@google/generative-ai"

export class GeminiHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client: GoogleGenerativeAI

    constructor(options: ApiHandlerOptions) {
        this.options = options
        this.client = new GoogleGenerativeAI(this.options.geminiApiKey!)
    }

    async createMessage(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[],
        tools: Anthropic.Messages.Tool[]
    ): Promise<Anthropic.Messages.Message> {
        const model = this.client.getGenerativeModel({ model: this.getModel().id })

        const chat = model.startChat({
            history: this.convertToGeminiMessages(messages),
            generationConfig: {
                maxOutputTokens: this.getModel().info.maxTokens,
            },
        })

        const result = await chat.sendMessage(systemPrompt)
        const response = await result.response

        return this.convertToAnthropicMessage(response)
    }

    createUserReadableRequest(
        userContent: Array<
            | Anthropic.TextBlockParam
            | Anthropic.ImageBlockParam
            | Anthropic.ToolUseBlockParam
            | Anthropic.ToolResultBlockParam
        >
    ): any {
        return {
            model: this.getModel().id,
            max_tokens: this.getModel().info.maxTokens,
            system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
            messages: [{ conversation_history: "..." }, { role: "user", content: withoutImageData(userContent) }],
            tools: "(see tools in src/ClaudeDev.ts)",
            tool_choice: { type: "auto" },
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

    private convertToGeminiMessages(messages: Anthropic.Messages.MessageParam[]): { role: string; parts: string[] }[] {
        return messages.map(message => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [typeof message.content === "string" ? message.content : JSON.stringify(message.content)]
        }))
    }

    private convertToAnthropicMessage(response: any): Anthropic.Messages.Message {
        return {
            id: `gemini-${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [
                {
                    type: "text",
                    text: response.text(),
                },
            ],
            model: this.getModel().id,
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: 0, // Gemini doesn't provide token usage information
                output_tokens: 0,
            },
        }
    }
}
