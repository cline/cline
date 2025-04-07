export function range(startOrEnd: number, end?: number): number[] {
    let length = startOrEnd
    let start = 0
    if (typeof end === 'number') {
        start = startOrEnd
        length = end - start
    }
    return Array.from({ length }, (_, i) => i + start)
}

export function sampleOne<T>(items: T[]): T {
    if (!items.length) {
        throw Error('Items array is empty!')
    }
    const index = Math.floor(Math.random() * items.length)
    return items[index]
}

export const shouldIgnoreInput = (e: KeyboardEvent): boolean => {
    return (
        ['input', 'textarea'].includes((e.target as HTMLElement).tagName.toLowerCase()) ||
        (e.target as HTMLElement).isContentEditable ||
        (e.target as HTMLElement).parentElement?.isContentEditable ||
        false
    )
}

export function uuid(): string {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (
            parseInt(c) ^
            ((typeof window?.crypto !== 'undefined' // in node tests, jsdom doesn't implement window.crypto
                ? window.crypto.getRandomValues(new Uint8Array(1))[0]
                : Math.floor(Math.random() * 256)) &
                (15 >> (parseInt(c) / 4)))
        ).toString(16)
    )
}

export function isExternalLink(input: any): boolean {
    if (!input || typeof input !== 'string') {
        return false
    }
    const regexp = /^(https?:|mailto:)/
    return !!input.trim().match(regexp)
}
