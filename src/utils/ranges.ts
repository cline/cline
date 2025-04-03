import { Range } from '../autocomplete/types'

export function getRangeInString(content: string, range: Range): string {
    const lines = content.split('\n')

    if (range.start.line === range.end.line) {
        return lines[range.start.line]?.substring(range.start.character, range.end.character) ?? ''
    }

    const firstLine = lines[range.start.line]?.substring(range.start.character, lines[range.start.line].length) ?? ''
    const middleLines = lines.slice(range.start.line + 1, range.end.line)
    const lastLine = lines[range.end.line]?.substring(0, range.end.character) ?? ''

    return [firstLine, ...middleLines, lastLine].join('\n')
}

export function intersection(a: Range, b: Range): Range | null {
    const startLine = Math.max(a.start.line, b.start.line)
    const endLine = Math.min(a.end.line, b.end.line)

    if (startLine > endLine) {
        return null
    }

    if (startLine === endLine) {
        const startCharacter = Math.max(a.start.character, b.start.character)
        const endCharacter = Math.min(a.end.character, b.end.character)

        if (startCharacter > endCharacter) {
            return null
        }

        return {
            start: { line: startLine, character: startCharacter },
            end: { line: endLine, character: endCharacter },
        }
    }

    const startCharacter = startLine === a.start.line ? a.start.character : b.start.character
    const endCharacter = endLine === a.end.line ? a.end.character : b.end.character

    return {
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter },
    }
}
