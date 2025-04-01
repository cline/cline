import { OpenAI } from 'openai/index'
import {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionCreateParams,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
    Completion,
    CompletionCreateParamsNonStreaming,
    CompletionCreateParamsStreaming,
    Model,
} from 'openai/resources/index'
import { BaseLlmApi, CreateRerankResponse, FimCreateParamsStreaming, RerankCreateParams } from '../types'
import * as z from 'zod'
import { fetchwithRequestOptions } from './fetch'

export const clientCertificateOptionsSchema = z.object({
    cert: z.string(),
    key: z.string(),
    passphrase: z.string().optional(),
})
export const requestOptionsSchema = z.object({
    timeout: z.number().optional(),
    verifySsl: z.boolean().optional(),
    caBundlePath: z.union([z.string(), z.array(z.string())]).optional(),
    proxy: z.string().optional(),
    headers: z.record(z.string()).optional(),
    extraBodyProperties: z.record(z.any()).optional(),
    noProxy: z.array(z.string()).optional(),
    clientCertificate: clientCertificateOptionsSchema.optional(),
})
export type RequestOptions = z.infer<typeof requestOptionsSchema>
export function maybeCustomFetch(requestOptions: RequestOptions | undefined) {
    return requestOptions ? (url: any, init: any) => fetchwithRequestOptions(url, init, requestOptions) : undefined
}

export function customFetch(requestOptions: RequestOptions | undefined) {
    return maybeCustomFetch(requestOptions) ?? fetch
}
async function* toAsyncIterable(nodeReadable: NodeJS.ReadableStream): AsyncGenerator<Uint8Array> {
    for await (const chunk of nodeReadable) {
        // @ts-ignore
        yield chunk as Uint8Array
    }
}

export async function* streamResponse(response: Response): AsyncGenerator<string> {
    if (response.status !== 200) {
        throw new Error(await response.text())
    }

    if (!response.body) {
        throw new Error('No response body returned.')
    }

    // Get the major version of Node.js
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0], 10)

    if (nodeMajorVersion >= 20) {
        // Use the new API for Node 20 and above
        const stream = (ReadableStream as any).from(response.body)
        for await (const chunk of stream.pipeThrough(new TextDecoderStream('utf-8'))) {
            yield chunk
        }
    } else {
        // Fallback for Node versions below 20
        // Streaming with this method doesn't work as version 20+ does
        const decoder = new TextDecoder('utf-8')
        const nodeStream = response.body as unknown as NodeJS.ReadableStream
        for await (const chunk of toAsyncIterable(nodeStream)) {
            yield decoder.decode(chunk, { stream: true })
        }
    }
}
function parseDataLine(line: string): any {
    const json = line.startsWith('data: ') ? line.slice('data: '.length) : line.slice('data:'.length)

    try {
        const data = JSON.parse(json)
        if (data.error) {
            throw new Error(`Error streaming response: ${data.error}`)
        }

        return data
    } catch (e) {
        throw new Error(`Malformed JSON sent from server: ${json}`)
    }
}

function parseSseLine(line: string): { done: boolean; data: any } {
    if (line.startsWith('data: [DONE]')) {
        return { done: true, data: undefined }
    }
    if (line.startsWith('data:')) {
        return { done: false, data: parseDataLine(line) }
    }
    if (line.startsWith(': ping')) {
        return { done: true, data: undefined }
    }
    return { done: false, data: undefined }
}

export async function* streamSse(response: Response): AsyncGenerator<any> {
    let buffer = ''
    for await (const value of streamResponse(response)) {
        buffer += value

        let position: number
        while ((position = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, position)
            buffer = buffer.slice(position + 1)

            const { done, data } = parseSseLine(line)
            if (done) {
                break
            }
            if (data) {
                yield data
            }
        }
    }

    if (buffer.length > 0) {
        const { done, data } = parseSseLine(buffer)
        if (!done && data) {
            yield data
        }
    }
}

export class OpenAIApi implements BaseLlmApi {
    openai: OpenAI
    apiBase: string = 'https://api.openai.com/v1/'

    constructor(protected config: any) {
        this.apiBase = config.apiBase ?? this.apiBase
        this.openai = new OpenAI({
            apiKey: config.apiKey,
            baseURL: this.apiBase,
            fetch: customFetch(config.requestOptions) as any,
        })
    }

    modifyChatBody<T extends ChatCompletionCreateParams>(body: T): T {
        // o-series models
        if (body.model.startsWith('o')) {
            // a) use max_completion_tokens instead of max_tokens
            body.max_completion_tokens = body.max_tokens
            body.max_tokens = undefined

            // b) use "developer" message role rather than "system"
            body.messages = body.messages.map((message) => {
                if (message.role === 'system') {
                    return { ...message, role: 'developer' } as any
                }
                return message
            })
        }
        return body
    }

    async chatCompletionNonStream(
        body: ChatCompletionCreateParamsNonStreaming,
        signal: AbortSignal
    ): Promise<ChatCompletion> {
        const response = await this.openai.chat.completions.create(this.modifyChatBody(body), {
            signal,
        })
        return response
    }
    async *chatCompletionStream(
        body: ChatCompletionCreateParamsStreaming,
        signal: AbortSignal
    ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
        const response = await this.openai.chat.completions.create(this.modifyChatBody(body), {
            signal,
        })
        for await (const result of response) {
            yield result
        }
    }
    async completionNonStream(body: CompletionCreateParamsNonStreaming, signal: AbortSignal): Promise<Completion> {
        const response = await this.openai.completions.create(body, { signal })
        return response
    }
    async *completionStream(
        body: CompletionCreateParamsStreaming,
        signal: AbortSignal
    ): AsyncGenerator<Completion, any, unknown> {
        const response = await this.openai.completions.create(body, { signal })
        for await (const result of response) {
            yield result
        }
    }
    async *fimStream(
        body: FimCreateParamsStreaming,
        signal: AbortSignal
    ): AsyncGenerator<ChatCompletionChunk, any, unknown> {
        const endpoint = new URL('fim/completions', this.apiBase)
        const resp = await customFetch(this.config.requestOptions)(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                model: body.model,
                prompt: body.prompt,
                suffix: body.suffix,
                max_tokens: body.max_tokens,
                max_completion_tokens: (body as any).max_completion_tokens,
                temperature: body.temperature,
                top_p: body.top_p,
                frequency_penalty: body.frequency_penalty,
                presence_penalty: body.presence_penalty,
                stop: body.stop,
                stream: true,
            }),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-api-key': this.config.apiKey ?? '',
                Authorization: `Bearer ${this.config.apiKey}`,
            },
            signal,
        })
        for await (const chunk of streamSse(resp as any)) {
            if (chunk.choices && chunk.choices.length > 0) {
                yield chunk
            }
        }
    }

    async embed(body: OpenAI.Embeddings.EmbeddingCreateParams): Promise<OpenAI.Embeddings.CreateEmbeddingResponse> {
        const response = await this.openai.embeddings.create(body)
        return response
    }

    async rerank(body: RerankCreateParams): Promise<CreateRerankResponse> {
        const endpoint = new URL('rerank', this.apiBase)
        const response = await customFetch(this.config.requestOptions)(endpoint, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'x-api-key': this.config.apiKey ?? '',
                Authorization: `Bearer ${this.config.apiKey}`,
            },
        })
        const data = await response.json()
        return data as any
    }

    async list(): Promise<Model[]> {
        return (await this.openai.models.list()).data
    }
}
