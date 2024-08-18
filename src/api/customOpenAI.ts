import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, withoutImageData } from "."
import {
    ApiHandlerOptions,
    ModelInfo,
    customOpenAIDefaultModelId,
    CustomOpenAIModelId,
    customOpenAIModels,
} from "../shared/api"

export class CustomOpenAIHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private client: OpenAI

    constructor(options: ApiHandlerOptions) {
        this.options = options

        this.client = new OpenAI({
            apiKey: this.options.customOpenAIApiKey,
            baseURL: this.options.customOpenAIBaseUrl,
        })
    }

    async createMessage(
        systemPrompt: string,
        messages: Anthropic.Messages.MessageParam[],
        tools: Anthropic.Messages.Tool[]
    ): Promise<Anthropic.Messages.Message> {
        const openAiMessages = this.convertToOpenAiMessages(messages)

        const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
            },
        }))

        const model = this.getModel()

        const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
            model: model.id,
            messages: [
                { role: "system", content: systemPrompt },
                ...openAiMessages,
            ],
            tools: openAiTools,
            tool_choice: "auto",
        }
        // console.log("API request params:", JSON.stringify(createParams, null, 2))

        try {
            const completion = await this.client.chat.completions.create(createParams)
            const openAiMessage = completion.choices[0].message
            const anthropicMessage: Anthropic.Messages.Message = {
                id: completion.id,
                type: "message",
                role: openAiMessage.role,
                content: [
                    {
                        type: "text",
                        text: openAiMessage.content || "",
                    },
                ],
                model: completion.model,
                stop_reason: (() => {
                    switch (completion.choices[0].finish_reason) {
                        case "stop":
                            return "end_turn"
                        case "length":
                            return "max_tokens"
                        case "tool_calls":
                            return "tool_use"
                        default:
                            return null
                    }
                })(),
                stop_sequence: null,
                usage: {
                    input_tokens: completion.usage?.prompt_tokens || 0,
                    output_tokens: completion.usage?.completion_tokens || 0,
                },
            }

            if (openAiMessage.tool_calls && openAiMessage.tool_calls.length > 0) {
                anthropicMessage.content.push(
                    ...openAiMessage.tool_calls.map((toolCall): Anthropic.ToolUseBlock => {
                        let parsedInput = {}
                        try {
                            parsedInput = JSON.parse(toolCall.function.arguments || "{}")
                        } catch (error) {
                            console.error("Failed to parse tool arguments:", error)
                        }
                        return {
                            type: "tool_use",
                            id: toolCall.id,
                            name: toolCall.function.name,
                            input: parsedInput,
                        }
                    })
                )
            }

            return anthropicMessage
        } catch (error) {
            console.error("Error calling DeepSeek API:", error)
            if (error instanceof OpenAI.APIError) {
                console.error("Status:", error.status)
                console.error("Message:", error.message)
                console.error("Code:", error.code)
                console.error("Type:", error.type)
            }
            throw error
        }
    }

    convertToOpenAiMessages(
        anthropicMessages: Anthropic.Messages.MessageParam[]
    ): OpenAI.Chat.ChatCompletionMessageParam[] {
        const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

        for (const anthropicMessage of anthropicMessages) {
            if (typeof anthropicMessage.content === "string") {
                openAiMessages.push({ role: anthropicMessage.role, content: anthropicMessage.content })
            } else {
                if (anthropicMessage.role === "user") {
                    const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
                        nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
                        toolMessages: Anthropic.ToolResultBlockParam[]
                    }>(
                        (acc, part) => {
                            if (part.type === "tool_result") {
                                acc.toolMessages.push(part)
                            } else if (part.type === "text" || part.type === "image") {
                                acc.nonToolMessages.push(part)
                            }
                            return acc
                        },
                        { nonToolMessages: [], toolMessages: [] }
                    )

                    if (nonToolMessages.length > 0) {
                        const content = nonToolMessages.map(part => {
                            if (part.type === "image") {
                                return `[Image: ${part.source.media_type}]`
                            }
                            return part.text
                        }).join("\n")

                        openAiMessages.push({
                            role: "user",
                            content: content
                        })
                    }

                    toolMessages.forEach((toolMessage) => {
                        let content: string

                        if (typeof toolMessage.content === "string") {
                            content = toolMessage.content
                        } else {
                            content =
                                toolMessage.content
                                    ?.map((part) => {
                                        if (part.type === "image") {
                                            return "[Image content]"
                                        }
                                        return part.text
                                    })
                                    .join("\n") ?? ""
                        }
                        openAiMessages.push({
                            role: "tool",
                            tool_call_id: toolMessage.tool_use_id,
                            content: content,
                        })
                    })
                } else if (anthropicMessage.role === "assistant") {
                    const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
                        nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
                        toolMessages: Anthropic.ToolUseBlockParam[]
                    }>(
                        (acc, part) => {
                            if (part.type === "tool_use") {
                                acc.toolMessages.push(part)
                            } else if (part.type === "text" || part.type === "image") {
                                acc.nonToolMessages.push(part)
                            }
                            return acc
                        },
                        { nonToolMessages: [], toolMessages: [] }
                    )

                    let content: string | undefined
                    if (nonToolMessages.length > 0) {
                        content = nonToolMessages
                            .map((part) => {
                                if (part.type === "image") {
                                    return "[Image content]"
                                }
                                return part.text
                            })
                            .join("\n")
                    }

                    let tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolMessages.map((toolMessage) => ({
                        id: toolMessage.id,
                        type: "function",
                        function: {
                            name: toolMessage.name,
                            arguments: JSON.stringify(toolMessage.input),
                        },
                    }))

                    openAiMessages.push({
                        role: "assistant",
                        content: content || null,
                        tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
                    })
                }
            }
        }

        return openAiMessages
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
            tool_choice: "auto",
        }
    }

    getModel(): { id: CustomOpenAIModelId; info: ModelInfo } {
        const modelId = this.options.apiModelId || customOpenAIDefaultModelId
        console.log("Requested model ID:", modelId)
        if (modelId in customOpenAIModels) {
            console.log("Using model:", modelId)
            return { id: modelId as CustomOpenAIModelId, info: customOpenAIModels[modelId as CustomOpenAIModelId] }
        }
        console.log("Using default model:", customOpenAIDefaultModelId)
        return { id: customOpenAIDefaultModelId, info: customOpenAIModels[customOpenAIDefaultModelId] }
    }
}