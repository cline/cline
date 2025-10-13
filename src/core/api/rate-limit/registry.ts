import SlidingWindowLimiter, { SlidingWindowLimits } from "./SlidingWindowLimiter"

const REGISTRY = new Map<string, SlidingWindowLimiter>()

/**
 * Create a stable registry key for a provider+model (or any custom scope).
 * Example: makeKey("openai", "gpt-5") -> "openai::gpt-5"
 */
export function makeKey(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`
}

/**
 * Returns a memoized SlidingWindowLimiter instance for the given key.
 * If limits are provided and a limiter already exists, updates that limiter's limits.
 */
export function getLimiter(key: string, limits?: SlidingWindowLimits): SlidingWindowLimiter {
	let limiter = REGISTRY.get(key)
	if (!limiter) {
		limiter = new SlidingWindowLimiter(limits ?? {})
		REGISTRY.set(key, limiter)
	} else if (limits) {
		limiter.setLimits(limits)
	}
	return limiter
}

/**
 * For testing/debug: clear the registry.
 */
export function __clearRegistry() {
	REGISTRY.clear()
}
