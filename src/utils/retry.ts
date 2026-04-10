export interface RetryWithBackoffOptions {
	maxAttempts?: number
	baseDelayMs?: number
	maxDelayMs?: number
	multiplier?: number
	operationName?: string
	shouldRetry?: (error: unknown, attempt: number) => boolean
	onRetry?: (error: unknown, attempt: number, maxAttempts: number, delayMs: number) => void | Promise<void>
}

/**
 * Retries an async operation with exponential backoff.
 *
 * Flow:
 * 1. Try `operation()` immediately.
 * 2. If it succeeds, return the result right away.
 * 3. If it fails, decide whether to retry:
 *    - stop if this was the last attempt
 *    - stop if `shouldRetry(error, attempt)` returns false
 * 4. If retrying, compute delay using exponential growth:
 *    `baseDelayMs * multiplier^(attempt - 1)`, capped by `maxDelayMs`.
 * 5. Call optional `onRetry(...)`, wait for the delay, and try again.
 * 6. If all attempts fail, throw one final error with `operationName` and the last error message.
 *
 * Example timing with `maxAttempts=3`, `baseDelayMs=50`, `multiplier=2`:
 * - Attempt 1 fails -> wait 50ms
 * - Attempt 2 fails -> wait 100ms
 * - Attempt 3 fails -> throw final error
 * Total backoff wait before final failure: 150ms (plus operation runtime).
 */
export async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryWithBackoffOptions = {}): Promise<T> {
	const {
		maxAttempts = 3,
		baseDelayMs = 50,
		maxDelayMs = Number.POSITIVE_INFINITY,
		multiplier = 2,
		operationName = "Operation",
		shouldRetry = () => true,
		onRetry,
	} = options

	let lastError: unknown

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await operation()
		} catch (error) {
			lastError = error
			const isLastAttempt = attempt === maxAttempts
			if (isLastAttempt || !shouldRetry(error, attempt)) {
				break
			}

			const delayMs = Math.min(baseDelayMs * multiplier ** (attempt - 1), maxDelayMs)
			await onRetry?.(error, attempt, maxAttempts, delayMs)
			await new Promise((resolve) => setTimeout(resolve, delayMs))
		}
	}

	throw new Error(
		`${operationName} failed after ${maxAttempts} attempts: ${
			lastError instanceof Error ? lastError.message : String(lastError)
		}`,
	)
}

/**
 * TypeScript equivalent of the Go common.RetryOperation utility
 * Performs an operation with retry logic and timeout handling
 */
export async function retryOperation<T>(maxRetries: number, timeoutPerAttempt: number, operation: () => Promise<T>): Promise<T> {
	let lastError: Error | undefined

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Create a timeout promise
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Operation timeout")), timeoutPerAttempt),
			)

			// Race the operation against timeout
			const result = await Promise.race([operation(), timeoutPromise])
			return result // Success - return result
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))

			if (attempt < maxRetries) {
				// Brief delay before retry
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
		}
	}

	throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError?.message}`)
}
