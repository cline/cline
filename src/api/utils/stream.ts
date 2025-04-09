export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk = ApiStreamTextChunk | ApiStreamReasoningChunk | ApiStreamUsageChunk

export interface ApiStreamTextChunk {
    type: 'text'
    text: string
}

export interface ApiStreamReasoningChunk {
    type: 'reasoning'
    reasoning: string
}

export interface ApiStreamUsageChunk {
    type: 'usage'
    inputTokens: number
    outputTokens: number
    cacheWriteTokens?: number
    cacheReadTokens?: number
}

export type LineStream = AsyncGenerator<string>

/**
 * Convert a stream of arbitrary chunks to a stream of lines
 */
export async function* streamLines(streamCompletion: AsyncGenerator<string>, log: boolean = false): LineStream {
    let allLines = []

    let buffer = ''

    try {
        for await (const update of streamCompletion) {
            const chunk = update
            buffer += chunk
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                yield line
                allLines.push(line)
            }
        }
        if (buffer.length > 0) {
            yield buffer
            allLines.push(buffer)
        }
    } finally {
        if (log) {
            console.log('Streamed lines: ', allLines.join('\n'))
        }
    }
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
