import { ApiHandler } from '../index'
import { Anthropic } from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { ApiStream, ApiStreamChunk, ApiStreamTextChunk, ApiStreamUsageChunk } from '../transform/stream'

import type { ApiHandlerOptions } from '../../shared/api'
import type { ModelInfo } from '../../shared/api'

export class InkeepHandler implements ApiHandler {
    private client: OpenAI
    private modelId: string = 'inkeep-context-expert'
    private modelInfo: ModelInfo = {
        maxTokens: 8192,
        contextWindow: 128_000,
        supportsImages: false,
        supportsPromptCache: false,
        inputPrice: 0,
        outputPrice: 0,
    }

    constructor(options: ApiHandlerOptions) {
        if (!options.inkeepApiKey) {
            throw new Error('Inkeep API key is required')
        }

        this.client = new OpenAI({
            apiKey: options.inkeepApiKey,
            baseURL: 'https://api.inkeep.com/v1',
        })
    }

    async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
        const openAiMessages = messages.map((msg) => ({
            role: msg.role as 'user' | 'assistant',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }))

        const stream = await this.client.chat.completions.create({
            model: this.modelId,
            messages: openAiMessages,
            stream: true,
            stream_options: { include_usage: true },
        })

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta
            if (delta?.content) {
                yield {
                    type: 'text',
                    text: delta.content,
                } as ApiStreamTextChunk
            }

            if (chunk.usage) {
                yield {
                    type: 'usage',
                    inputTokens: chunk.usage.prompt_tokens || 0,
                    outputTokens: chunk.usage.completion_tokens || 0,
                } as ApiStreamUsageChunk
            }
        }
    }

    getModel(): { id: string; info: ModelInfo } {
        return {
            id: this.modelId,
            info: this.modelInfo,
        }
    }
}
