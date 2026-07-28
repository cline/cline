import { Logger } from "@/shared/services/Logger"

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

export class RetriableError extends Error {
	status: number = 429
	retryAfter?: number

	constructor(message: string, retryAfter?: number, options?: ErrorOptions) {
		super(message, options)
		this.name = "RetriableError"

		this.retryAfter = retryAfter
	}
}

const INFERENCE_CAP_ERROR_CODE = "INFERENCE_CAP_ERROR"

/**
 * Inference cap errors mean the user is out of quota until it resets, so retrying
 * only burns backoff. Providers surface the code in a few shapes: directly on the
 * error, nested under `error`/`details`, or embedded in a wrapped message string
 * (see ClineHandler, which rethrows stream errors as `Cline API Error <code>: ...`).
 */
function isInferenceCapError(error: any): boolean {
	if (
		error?.code === INFERENCE_CAP_ERROR_CODE ||
		error?.error?.code === INFERENCE_CAP_ERROR_CODE ||
		error?.details?.code === INFERENCE_CAP_ERROR_CODE
	) {
		return true
	}

	return typeof error?.message === "string" && error.message.includes(INFERENCE_CAP_ERROR_CODE)
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
					const isRateLimit = error?.status === 429 || error instanceof RetriableError
					const isLastAttempt = attempt === maxRetries - 1
					// We shouldn't retry cap limits because they mean the user needs to wait for longer
					const isCapLimitError = isInferenceCapError(error)
					if ((!isRateLimit && !retryAllErrors) || isLastAttempt || isCapLimitError) {
						throw error
					}

					// Get retry delay from header or calculate exponential backoff
					// Check various rate limit headers
					const retryAfter =
						error.headers?.["retry-after"] ||
						error.headers?.["x-ratelimit-reset"] ||
						error.headers?.["ratelimit-reset"] ||
						error.retryAfter

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
							Logger.error("Error in onRetryAttempt callback:", e)
						}
					}

					await new Promise((resolve) => setTimeout(resolve, delay))
				}
			}
		}

		return descriptor
	}
}
