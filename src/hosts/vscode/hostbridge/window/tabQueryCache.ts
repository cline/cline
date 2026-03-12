type CachedTabQueryOptions = {
	ttlMs?: number
	getNow?: () => number
}

type CacheEntry = {
	value: string[]
	expiresAt: number
}

export type CachedTabQuery<TResponse> = {
	read: () => Promise<TResponse>
	reset: () => void
	setTtlForTests: (ttlMs: number) => void
}

export function createCachedTabQuery<TResponse>(
	query: () => Promise<string[]>,
	buildResponse: (paths: string[]) => TResponse,
	options?: CachedTabQueryOptions,
): CachedTabQuery<TResponse> {
	let ttlMs = options?.ttlMs ?? 500
	const getNow = options?.getNow ?? (() => Date.now())
	let cache: CacheEntry | undefined

	return {
		read: async () => {
			const now = getNow()
			if (cache && cache.expiresAt > now) {
				return buildResponse(cache.value)
			}

			const paths = await query()
			cache = {
				value: paths,
				expiresAt: now + ttlMs,
			}

			return buildResponse(paths)
		},
		reset: () => {
			cache = undefined
		},
		setTtlForTests: (nextTtlMs: number) => {
			ttlMs = nextTtlMs
			cache = undefined
		},
	}
}
