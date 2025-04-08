import { describe, it, expect, assert } from "vitest"
import { withRetry } from "../retry"

describe("Retry Decorator", () => {
	describe("withRetry", () => {
		it("should not retry on success", async () => {
			let callCount = 0
			class TestClass {
				@withRetry()
				async *successMethod() {
					callCount++
					yield "success"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.successMethod()) {
				result.push(value)
			}

			expect(callCount).toBe(1)
			expect(result).toEqual(["success"])
		})

		it("should retry on rate limit (429) error", async () => {
			let callCount = 0
			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 10, maxDelay: 100 })
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			expect(callCount).toBe(2)
			expect(result).toEqual(["success after retry"])
		})

		it("should not retry on non-rate-limit errors", async () => {
			let callCount = 0
			class TestClass {
				@withRetry()
				async *failMethod() {
					callCount++
					throw new Error("Regular error")
				}
			}

			const test = new TestClass()
			try {
				for await (const _ of test.failMethod()) {
					// Should not reach here
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				expect(error.message).toBe("Regular error")
				expect(callCount).toBe(1)
			}
		})

		it("should respect retry-after header with delta seconds", async () => {
			let callCount = 0
			const startTime = Date.now()
			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 1000 }) // Use large baseDelay to ensure header takes precedence
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						error.headers = { "retry-after": "0.01" } // 10ms delay
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			const duration = Date.now() - startTime
			assert.closeTo(duration, 10, 10, "duration should be 10 ± 10ms")
			expect(callCount).toBe(2)
			expect(result).toEqual(["success after retry"])
		})

		it("should respect retry-after header with Unix timestamp", async () => {
			let callCount = 0
			const startTime = Date.now()
			const retryTimestamp = Math.floor(Date.now() / 1000) + 0.01 // 10ms in the future

			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 1000 }) // Use large baseDelay to ensure header takes precedence
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						error.headers = { "retry-after": retryTimestamp.toString() }
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			const duration = Date.now() - startTime
			assert.closeTo(duration, 10, 10, "duration should be 10 ± 10ms")
			expect(callCount).toBe(2)
			expect(result).toEqual(["success after retry"])
		})

		it("should use exponential backoff when no retry-after header", async () => {
			let callCount = 0
			const startTime = Date.now()
			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 10, maxDelay: 100 })
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			const duration = Date.now() - startTime
			// First retry should be after baseDelay (10ms)
			assert.closeTo(duration, 10, 10, "duration should be 10 ± 10ms")
			expect(callCount).toBe(2)
			expect(result).toEqual(["success after retry"])
		})

		it("should respect maxDelay", async () => {
			let callCount = 0
			const startTime = Date.now()
			class TestClass {
				@withRetry({ maxRetries: 3, baseDelay: 50, maxDelay: 10 })
				async *failMethod() {
					callCount++
					if (callCount < 3) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success after retries"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			const duration = Date.now() - startTime
			// Both retries should be capped at maxDelay (10ms each)
			assert.closeTo(duration, 20, 10, "duration should be 20 ± 10ms")
			expect(callCount).toBe(3)
			expect(result).toEqual(["success after retries"])
		})

		it("should throw after maxRetries attempts", async () => {
			let callCount = 0
			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 10 })
				async *failMethod() {
					callCount++
					const error: any = new Error("Rate limit exceeded")
					error.status = 429
					throw error
				}
			}

			const test = new TestClass()
			try {
				for await (const _ of test.failMethod()) {
					// Should not reach here
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				expect(error.message).toBe("Rate limit exceeded")
				expect(callCount).toBe(2) // Initial attempt + 1 retry
			}
		})
	})
})
