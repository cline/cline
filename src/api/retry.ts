interface RetryOptions {
	maxRetries?: number
	baseDelay?: number
	maxDelay?: number
	retryAllErrors?: boolean
	regionCycling?: boolean // Whether to cycle through multiple regions on failure
	maxRetriesPerRegion?: number // Maximum retries per region before cycling to next region
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	baseDelay: 1_000,
	maxDelay: 10_000,
	retryAllErrors: false,
	regionCycling: false,
	maxRetriesPerRegion: 1, // Default to just 1 retry per region when cycling is enabled
}

export interface RegionProvider {
	/**
	 * Gets the currently used region
	 */
	getCurrentRegion(): string

	/**
	 * Cycles to the next region if available
	 * @returns true if successfully cycled to a new region, false if no more regions available
	 */
	cycleToNextRegion(): boolean

	/**
	 * Resets the region to the default/first region
	 */
	resetRegion(): void
}

export function withRetry(options: RetryOptions = {}) {
	const { maxRetries, baseDelay, maxDelay, retryAllErrors, regionCycling, maxRetriesPerRegion } = {
		...DEFAULT_OPTIONS,
		...options,
	}

	return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value

		descriptor.value = async function* (...args: any[]) {
			// Track current attempt and region cycling counters
			let totalAttempts = 0
			let currentRegionAttempts = 0
			let hasRegionCycled = false
			let completeCycles = 0 // Track how many times we've cycled through all available regions

			// For non-region cycling cases or instances that don't implement RegionProvider,
			// use the original behavior
			const supportsRegionCycling = regionCycling && "cycleToNextRegion" in this

			// Fixed delay between region switches within a cycle
			const REGION_SWITCH_DELAY = 500 // milliseconds

			// Keep trying until we hit max retries
			while (totalAttempts < maxRetries) {
				try {
					// If we've cycled regions after a failure, log it
					if (hasRegionCycled) {
						console.log(`Retrying with region: ${(this as RegionProvider).getCurrentRegion()}`)
					}

					yield* originalMethod.apply(this, args)
					return
				} catch (error: any) {
					totalAttempts++
					currentRegionAttempts++

					// Check if this is an error we should retry
					const isRateLimit = error?.status === 429
					const isServiceUnavailable = error?.status === 503
					const shouldRetryError = isRateLimit || isServiceUnavailable || retryAllErrors
					const isLastAttempt = totalAttempts >= maxRetries

					// If this is not an error we should retry, or we've reached max retries, throw the error
					if (!shouldRetryError || isLastAttempt) {
						throw error
					}

					// Check if we should cycle to the next region
					// Either because we hit max retries per region or specifically for 429 errors, cycle immediately
					const shouldCycleRegion =
						supportsRegionCycling &&
						(currentRegionAttempts >= maxRetriesPerRegion || (isRateLimit && currentRegionAttempts >= 1))

					let startingNewCycle = false

					if (shouldCycleRegion) {
						// Try to cycle to the next region
						const cycledSuccessfully = (this as RegionProvider).cycleToNextRegion()

						// If we successfully cycled to a new region, reset region attempt counter
						if (cycledSuccessfully) {
							hasRegionCycled = true
							currentRegionAttempts = 0
						} else {
							// If cycling failed, it means we've tried all regions in the current cycle
							// Reset to the first region and increment the complete cycles counter
							;(this as RegionProvider).resetRegion()
							completeCycles++
							hasRegionCycled = true
							currentRegionAttempts = 0
							startingNewCycle = true

							console.log(
								`Completed region cycle #${completeCycles}, restarting with region: ${(this as RegionProvider).getCurrentRegion()}`,
							)
						}
					}

					// Calculate delay for next retry
					// Get retry delay from header or calculate exponential backoff
					const retryAfter =
						error.headers?.["retry-after"] ||
						error.headers?.["x-ratelimit-reset"] ||
						error.headers?.["ratelimit-reset"]

					let delay: number
					if (retryAfter) {
						// Handle both delta-seconds and Unix timestamp formats
						const retryValue = parseInt(retryAfter, 10)
						if (retryValue > Date.now() / 1000) {
							// Unix timestamp
							delay = retryValue * 1000 - Date.now()
						} else {
							// Delta seconds
							delay = retryValue * 1000
						}
					} else if (supportsRegionCycling) {
						if (startingNewCycle) {
							// Only apply exponential backoff when starting a new cycle of regions
							const backoffExp = completeCycles
							delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, backoffExp)))
						} else {
							// Use fixed delay between region switches within a cycle
							delay = REGION_SWITCH_DELAY
						}
					} else {
						// Non-region-cycling providers continue to use the original exponential backoff
						const backoffExp = totalAttempts - 1
						delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, backoffExp)))
					}

					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		return descriptor
	}
}
