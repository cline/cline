/**
 * Network helpers for the VS Code extension.
 *
 * Use this fetch wrapper instead of calling global fetch directly so tests can
 * replace the implementation without changing production call sites.
 */

type FetchFunction = (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>

let mockFetch: FetchFunction | undefined

export const fetch: typeof globalThis.fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> =>
	(mockFetch || globalThis.fetch)(input, init)) as typeof globalThis.fetch

export function mockFetchForTesting<T>(theFetch: FetchFunction, callback: () => T): T {
	const originalMockFetch = mockFetch
	mockFetch = theFetch
	let willResetSync = true
	try {
		const result = callback()
		if (result instanceof Promise) {
			willResetSync = false
			return result.finally(() => {
				mockFetch = originalMockFetch
			}) as typeof result
		}
		return result
	} finally {
		if (willResetSync) {
			mockFetch = originalMockFetch
		}
	}
}

export function getAxiosSettings(): {
	adapter?: any
	fetch?: typeof globalThis.fetch
	maxBodyLength?: number
	maxContentLength?: number
} {
	return {
		adapter: "fetch" as any,
		fetch,
		maxBodyLength: Number.POSITIVE_INFINITY,
		maxContentLength: Number.POSITIVE_INFINITY,
	}
}
