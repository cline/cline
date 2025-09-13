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

export function withRetry(options: RetryOptions = {}) {
	const { maxRetries, baseDelay, maxDelay, retryAllErrors } = { ...DEFAULT_OPTIONS, ...options }

	return (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => {
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
						delay = Math.min(maxDelay, baseDelay * 2 ** attempt)
					}

					const handlerInstance = this as any
					if (handlerInstance.options?.onRetryAttempt) {
						try {
							await handlerInstance.options.onRetryAttempt(attempt + 1, maxRetries, delay, error)
						} catch (e) {
							console.error("Error in onRetryAttempt callback:", e)
						}
					}

					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		return descriptor
	}
}
