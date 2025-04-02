import { Tiktoken, encodingForModel } from 'js-tiktoken'

interface Encoding {
    encode: Tiktoken['encode']
    decode: Tiktoken['decode']
}

const ENCODING_MODEL = 'gpt-4'

export function countTokens(content: string): number {
    const encoding = encodingForModel(ENCODING_MODEL)
    if (Array.isArray(content)) {
        return content.reduce((acc, part) => {
            return acc + encoding.encode(part.text ?? '', 'all', []).length
        }, 0)
    } else {
        return encoding.encode(content ?? '', 'all', []).length
    }
}

export function pruneLinesFromTop(prompt: string, maxTokens: number): string {
    let totalTokens = countTokens(prompt)
    const lines = prompt.split('\n')
    while (totalTokens > maxTokens && lines.length > 0) {
        totalTokens -= countTokens(lines.shift()!)
    }

    return lines.join('\n')
}

export function pruneLinesFromBottom(prompt: string, maxTokens: number): string {
    let totalTokens = countTokens(prompt)
    const lines = prompt.split('\n')
    while (totalTokens > maxTokens && lines.length > 0) {
        totalTokens -= countTokens(lines.pop()!)
    }
    return lines.join('\n')
}

export function pruneWithBinarySearch(text: string, maxTokens: number, fromBottom: boolean = true): string {
    const lines = text.split('\n')
    const encoding = encodingForModel(ENCODING_MODEL)

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
