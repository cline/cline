import { CompletionApiHandler } from '../'
import { ApiHandlerOptions, MistralModelId, mistralModels, ModelInfo } from '../../shared/api'
import { CompletionOptions } from '../../autocomplete/types'
import { withExponentialBackoff } from '../../autocomplete/util/fetch'
import { streamSse } from '../../autocomplete/util/stream'

const DEFAULT_MAX_TOKENS = 4096

export class CodestralHandler implements CompletionApiHandler {
    private options: ApiHandlerOptions
    private apiBase = 'https://codestral.mistral.ai/v1/'
    apiKey?: string

    constructor(options: ApiHandlerOptions) {
        this.options = options
        this.apiKey = options.codestralApiKey ?? undefined
    }

    async *streamFim(
        prefix: string,
        suffix: string,
        signal: AbortSignal,
        options: CompletionOptions = {}
    ): AsyncGenerator<string> {
        if (!this.apiKey) {
            throw new Error('No API key provided')
        }
        const endpoint = new URL('fim/completions', this.apiBase)

        const fimLog = `Prefix: ${prefix}\nSuffix: ${suffix}`
        let completion = ''

        const resp = await withExponentialBackoff<Response>(
            () =>
                fetch(endpoint, {
                    method: 'POST',
                    body: JSON.stringify({
                        model: this.getModel().id,
                        prompt: prefix,
                        suffix,
                        max_tokens: DEFAULT_MAX_TOKENS,
                        temperature: 0,
                        top_p: 1,
                        frequency_penalty: 0,
                        presence_penalty: 0,
                        stop: options.stop,
                        stream: true,
                    }),
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        'x-api-key': this.apiKey!,
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    signal,
                }) as any,
            5,
            0.5
        )

        for await (const chunk of streamSse(resp)) {
            let chunkContent = chunk.choices[0].delta.content
            completion += chunkContent
            yield chunkContent
        }

        return {
            prompt: fimLog,
            completion,
            options,
        }
    }

    getModel(): { id: MistralModelId; info: ModelInfo } {
        return {
            id: 'codestral-latest',
            info: mistralModels['codestral-latest'],
        }
    }
}
