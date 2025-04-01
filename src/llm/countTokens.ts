import { Tiktoken, encodingForModel as _encodingForModel } from 'js-tiktoken'
import { MessageContent, MessagePart, TemplateType } from './types'

interface Encoding {
    encode: Tiktoken['encode']
    decode: Tiktoken['decode']
}

function encodingForModel(_: string): Encoding {
    // TODO: Implement this
    return _encodingForModel('gpt-4')
}

function countImageTokens(content: MessagePart): number {
    if (content.type === 'imageUrl') {
        return 85
    }
    throw new Error('Non-image content type')
}

export function countTokens(content: MessageContent, modelName = 'gpt-4'): number {
    const encoding = encodingForModel(modelName)
    if (Array.isArray(content)) {
        return content.reduce((acc, part) => {
            return (
                acc +
                (part.type === 'text' ? encoding.encode(part.text ?? '', 'all', []).length : countImageTokens(part))
            )
        }, 0)
    } else {
        return encoding.encode(content ?? '', 'all', []).length
    }
}

export function pruneLinesFromTop(prompt: string, maxTokens: number, modelName: string): string {
    let totalTokens = countTokens(prompt, modelName)
    const lines = prompt.split('\n')
    while (totalTokens > maxTokens && lines.length > 0) {
        totalTokens -= countTokens(lines.shift()!, modelName)
    }

    return lines.join('\n')
}

export function pruneLinesFromBottom(prompt: string, maxTokens: number, modelName: string): string {
    let totalTokens = countTokens(prompt, modelName)
    const lines = prompt.split('\n')
    while (totalTokens > maxTokens && lines.length > 0) {
        totalTokens -= countTokens(lines.pop()!, modelName)
    }
    return lines.join('\n')
}

export function pruneWithBinarySearch(
    text: string,
    maxTokens: number,
    modelName: string,
    fromBottom: boolean = true
): string {
    const lines = text.split('\n')
    const encoding = encodingForModel(modelName)

    // Create array of token counts per line (only count once)
    const lineTokenCounts = lines.map((line) => encoding.encode(line, 'all', []).length)

    let left = 0
    let right = lines.length
    let bestValidCount = 0
    let bestValidLines: string[] = []

    while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        // If fromBottom is true, keep the last 'mid' lines
        // If fromBottom is false, keep the first 'mid' lines
        const selectedLines = fromBottom ? lines.slice(-mid) : lines.slice(0, mid)
        const totalTokens = fromBottom
            ? lineTokenCounts.slice(lines.length - mid).reduce((sum, count) => sum + count, 0)
            : lineTokenCounts.slice(0, mid).reduce((sum, count) => sum + count, 0)

        if (totalTokens <= maxTokens) {
            if (mid > bestValidCount) {
                bestValidCount = mid
                bestValidLines = selectedLines
            }
            left = mid + 1
        } else {
            right = mid - 1
        }
    }

    return bestValidLines.join('\n')
}
