/**
 * Manages retry logic for authentication operations with exponential backoff
 */
export class AuthRetryManager {
	private static readonly MAX_RETRIES = 3
	private static readonly BASE_DELAY = 1000 // 1 second
	private static readonly MAX_DELAY = 30000 // 30 seconds
	private static readonly BACKOFF_MULTIPLIER = 2

	private retryCount = 0
	private lastRetryTime = 0
	private circuitBreakerOpen = false
	private circuitBreakerOpenTime = 0
	private static readonly CIRCUIT_BREAKER_TIMEOUT = 300000 // 5 minutes

	/**
	 * Executes an operation with retry logic and exponential backoff
	 */
	async executeWithRetry<T>(
		operation: () => Promise<T>,
		operationName: string,
		onError?: (error: Error, attempt: number) => void,
	): Promise<T> {
		// Check circuit breaker
		if (this.circuitBreakerOpen) {
			const timeSinceOpen = Date.now() - this.circuitBreakerOpenTime
			if (timeSinceOpen < AuthRetryManager.CIRCUIT_BREAKER_TIMEOUT) {
				throw new Error(`Circuit breaker open for ${operationName}. Try again later.`)
			} else {
				// Reset circuit breaker
				this.circuitBreakerOpen = false
				this.retryCount = 0
			}
		}

		let lastError: Error | null = null

		for (let attempt = 0; attempt <= AuthRetryManager.MAX_RETRIES; attempt++) {
			try {
				const result = await operation()
				// Success - reset retry count
				this.retryCount = 0
				return result
			} catch (error) {
				lastError = error as Error
				console.error(`${operationName} attempt ${attempt + 1} failed:`, error)

				if (onError) {
					onError(lastError, attempt + 1)
				}

				// Don't retry on the last attempt
				if (attempt === AuthRetryManager.MAX_RETRIES) {
					break
				}

				// Calculate delay with exponential backoff
				const delay = Math.min(
					AuthRetryManager.BASE_DELAY * Math.pow(AuthRetryManager.BACKOFF_MULTIPLIER, attempt),
					AuthRetryManager.MAX_DELAY,
				)

				// Add jitter to prevent thundering herd
				const jitteredDelay = delay + Math.random() * 1000

				console.log(`Retrying ${operationName} in ${jitteredDelay}ms...`)
				await this.delay(jitteredDelay)
			}
		}

		// All retries failed - open circuit breaker
		this.retryCount = AuthRetryManager.MAX_RETRIES + 1
		this.circuitBreakerOpen = true
		this.circuitBreakerOpenTime = Date.now()

		throw new Error(`${operationName} failed after ${AuthRetryManager.MAX_RETRIES + 1} attempts: ${lastError?.message}`)
	}

	/**
	 * Resets the retry state (useful for successful operations)
	 */
	reset(): void {
		this.retryCount = 0
		this.circuitBreakerOpen = false
		this.circuitBreakerOpenTime = 0
	}

	/**
	 * Checks if the circuit breaker is currently open
	 */
	isCircuitBreakerOpen(): boolean {
		if (this.circuitBreakerOpen) {
			const timeSinceOpen = Date.now() - this.circuitBreakerOpenTime
			if (timeSinceOpen >= AuthRetryManager.CIRCUIT_BREAKER_TIMEOUT) {
				this.circuitBreakerOpen = false
				this.retryCount = 0
				return false
			}
			return true
		}
		return false
	}

	/**
	 * Gets the current retry count
	 */
	getRetryCount(): number {
		return this.retryCount
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
