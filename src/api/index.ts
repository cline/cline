import { Anthropic } from '@anthropic-ai/sdk'
import { ApiConfiguration, ModelInfo } from '../shared/api'
import { AnthropicHandler } from './providers/anthropic'
import { AwsBedrockHandler } from './providers/bedrock'
import { OpenRouterHandler } from './providers/openrouter'
import { VertexHandler } from './providers/vertex'
import { OpenAiHandler } from './providers/openai'
import { OllamaHandler } from './providers/ollama'
import { LmStudioHandler } from './providers/lmstudio'
import { GeminiHandler } from './providers/gemini'
import { OpenAiNativeHandler } from './providers/openai-native'
import { ApiStream, ApiStreamUsageChunk } from './transform/stream'
import { DeepSeekHandler } from './providers/deepseek'
import { RequestyHandler } from './providers/requesty'
import { TogetherHandler } from './providers/together'
import { QwenHandler } from './providers/qwen'
import { MistralHandler } from './providers/mistral'
import { VsCodeLmHandler } from './providers/vscode-lm'
import { LiteLlmHandler } from './providers/litellm'
import { AskSageHandler } from './providers/asksage'
import { XAIHandler } from './providers/xai'
import { SambanovaHandler } from './providers/sambanova'
import { CodestralHandler } from './providers/codestral'
import { CompletionOptions } from '../autocomplete/types'

export interface ApiHandler {
    createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream
    getModel(): { id: string; info: ModelInfo }
    getApiStreamUsage?(): Promise<ApiStreamUsageChunk | undefined>
}
export interface CompletionApiHandler {
    getModel(): { id: string; info: ModelInfo }
    streamFim(prefix: string, suffix: string, signal: AbortSignal, options?: CompletionOptions): AsyncGenerator<string>
}

export interface SingleCompletionHandler {
    completePrompt(prompt: string): Promise<string>
}

export function buildApiHandler(configuration: ApiConfiguration): ApiHandler {
    const { apiProvider, ...options } = configuration
    switch (apiProvider) {
        case 'anthropic':
            return new AnthropicHandler(options)
        case 'openrouter':
            return new OpenRouterHandler(options)
        case 'bedrock':
            return new AwsBedrockHandler(options)
        case 'vertex':
            return new VertexHandler(options)
        case 'openai':
            return new OpenAiHandler(options)
        case 'ollama':
            return new OllamaHandler(options)
        case 'lmstudio':
            return new LmStudioHandler(options)
        case 'gemini':
            return new GeminiHandler(options)
        case 'openai-native':
            return new OpenAiNativeHandler(options)
        case 'deepseek':
            return new DeepSeekHandler(options)
        case 'requesty':
            return new RequestyHandler(options)
        case 'together':
            return new TogetherHandler(options)
        case 'qwen':
            return new QwenHandler(options)
        case 'mistral':
            return new MistralHandler(options)
        case 'vscode-lm':
            return new VsCodeLmHandler(options)
        case 'litellm':
            return new LiteLlmHandler(options)
        case 'asksage':
            return new AskSageHandler(options)
        case 'xai':
            return new XAIHandler(options)
        case 'sambanova':
            return new SambanovaHandler(options)
        default:
            return new AnthropicHandler(options)
    }
}

export function buildCompletionApiHandler(configuration: ApiConfiguration): CompletionApiHandler {
    const { completionApiProvider, ...options } = configuration
    switch (completionApiProvider) {
        case 'codestral':
            return new CodestralHandler(options)
        default:
            return new CodestralHandler(options)
    }
}
