/**
 * Retry mechanism for API calls.
 * Provides a decorator that automatically retries failed generator methods with
 * configurable retry count, delay, and intelligent backoff based on rate limit headers.
 */

/**
 * Configuration options for the retry mechanism.
 *
 * @interface RetryOptions
 * @property {number} [maxRetries] - Maximum number of retry attempts (default: 3)
 * @property {number} [baseDelay] - Initial delay in milliseconds between retries (default: 1000)
 * @property {number} [maxDelay] - Maximum delay in milliseconds between retries (default: 10000)
 * @property {boolean} [retryAllErrors] - Whether to retry on all errors or only rate limit errors (default: false)
 */
interface RetryOptions {
	maxRetries?: number
	baseDelay?: number
	maxDelay?: number
	retryAllErrors?: boolean
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	baseDelay: 1_000,
	maxDelay: 10_000,
	retryAllErrors: false,
}

/**
 * Decorator factory that adds retry logic to an async generator method.
 * The decorated method will be automatically retried on failure with exponential backoff.
 *
 * Features:
 * - Smart handling of rate limit (429) errors
 * - Respects standard retry-after headers
 * - Exponential backoff with configurable base and maximum delay
 * - Option to retry all errors or only rate limit errors
 *
 * @example
 * ```typescript
 * class ApiClient {
 *   @withRetry()
 *   async *fetchData() {
 *     // Method that might fail due to rate limits
 *   }
 *
 *   @withRetry({ maxRetries: 5, retryAllErrors: true })
 *   async *fetchWithCustomRetry() {
 *     // Method with custom retry settings
 *   }
 * }
 * ```
 *
 * @param options - Configuration options for the retry behavior
 * @returns A method decorator that adds retry logic to the decorated method
 */
export function withRetry(options: RetryOptions = {}) {
	const { maxRetries, baseDelay, maxDelay, retryAllErrors } = { ...DEFAULT_OPTIONS, ...options }

	return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value

		descriptor.value = async function* (...args: any[]) {
			for (let attempt = 0; attempt < maxRetries; attempt++) {
				try {
					yield* originalMethod.apply(this, args)
					return
				} catch (error: any) {
					const isRateLimit = error?.status === 429
					const isLastAttempt = attempt === maxRetries - 1

					if ((!isRateLimit && !retryAllErrors) || isLastAttempt) {
						throw error
					}

					// Get retry delay from header or calculate exponential backoff
					// Check various rate limit headers
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
					} else {
						// Use exponential backoff if no header
						delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt))
					}

					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		return descriptor
	}
}
