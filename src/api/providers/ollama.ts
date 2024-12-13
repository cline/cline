import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { ApiStream } from "../transform/stream"

export class OllamaHandler implements ApiHandler {
    private options: ApiHandlerOptions
    private baseUrl: string

    constructor(options: ApiHandlerOptions) {
        this.options = options
        this.baseUrl = this.options.ollamaBaseUrl || "http://localhost:11434"
    }

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
        // Format messages for Ollama
        const formattedMessages = messages.map(msg => ({
            role: msg.role,
            content: Array.isArray(msg.content)
                ? msg.content.map(block => 
                    block.type === 'text' ? block.text : ''
                ).join('\n')
                : msg.content
        }))

        // Add system prompt as first message
        const prompt = [
            { role: 'system', content: systemPrompt },
            ...formattedMessages
        ]

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.options.ollamaModelId,
                    messages: prompt,
                    stream: true,
                    options: {
                        temperature: 0
                    }
                })
            })

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
            }

            if (!response.body) {
                throw new Error('No response body')
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let accumulatedText = ''
            let totalInputTokens = 0
            let totalOutputTokens = 0

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value)
                const lines = chunk.split('\n').filter(Boolean)

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line)
                        
                        if (data.done) {
                            // Final usage stats
                            yield {
                                type: "usage",
                                inputTokens: totalInputTokens,
                                outputTokens: totalOutputTokens
                            }
                            continue
                        }

                        if (data.message?.content) {
                            accumulatedText += data.message.content
                            totalOutputTokens += 1 // Approximate token count
                            
                            yield {
                                type: "text",
                                text: data.message.content
                            }
                        }

                        // Track input tokens (approximate)
                        if (data.prompt_eval_count) {
                            totalInputTokens = data.prompt_eval_count
                            yield {
                                type: "usage",
                                inputTokens: totalInputTokens,
                                outputTokens: totalOutputTokens
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing chunk:', e)
                    }
                }
            }
        } catch (error) {
            throw new Error(`Failed to communicate with Ollama: ${error.message}`)
        }
    }

    getModel(): { id: string; info: ModelInfo } {
        return {
            id: this.options.ollamaModelId || "",
            info: {
                ...openAiModelInfoSaneDefaults,
                contextWindow: 32768,
                maxTokens: 8192,
                supportsComputerUse: true,
            },
        }
    }
}
