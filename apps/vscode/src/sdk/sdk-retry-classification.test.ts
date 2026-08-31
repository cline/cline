import { describe, expect, it } from "vitest"

import { MAX_RETRY_DELAY_SECONDS } from "./sdk-api-retry-coordinator"
import { classifyFailureForRetry, readRetryAfterSeconds } from "./sdk-retry-classification"

/** Error shaped like the AI SDK's APICallError (typed fields only). */
function apiCallError(fields: Record<string, unknown> = {}): Error {
	return Object.assign(new Error("provider call failed"), fields)
}

describe("classifyFailureForRetry", () => {
	describe("retryable via typed signals", () => {
		it("retries HTTP 408, 429, and retryable 5xx statuses", () => {
			for (const statusCode of [408, 429, 500, 502, 503, 504]) {
				expect(classifyFailureForRetry({ error: apiCallError({ statusCode }) })).toEqual({ retryable: true })
			}
		})

		it("retries the AI SDK's typed isRetryable flag", () => {
			expect(classifyFailureForRetry({ error: apiCallError({ isRetryable: true }) })).toEqual({ retryable: true })
		})

		it("retries transport-level failure codes", () => {
			for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET"]) {
				expect(classifyFailureForRetry({ error: apiCallError({ code }) })).toEqual({ retryable: true })
			}
		})

		it("retries transport-level failure names (undici)", () => {
			for (const name of ["ConnectTimeoutError", "HeadersTimeoutError"]) {
				const error = new Error("connect timed out")
				error.name = name
				expect(classifyFailureForRetry({ error })).toEqual({ retryable: true })
			}
		})

		it("finds typed signals nested in the cause chain", () => {
			const error = apiCallError({ cause: Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }) })
			expect(classifyFailureForRetry({ error })).toEqual({ retryable: true })
		})

		it("unwraps the AI SDK RetryError's final attempt for the verdict", () => {
			const error = apiCallError({
				lastError: apiCallError({ statusCode: 503, responseHeaders: { "retry-after": "30" } }),
			})
			expect(classifyFailureForRetry({ error })).toEqual({ retryable: true, retryAfterSeconds: 30 })
		})

		it("lets HTTP metadata outrank message text (no substring matching)", () => {
			// Previously the substring blacklist made any "billing" message
			// permanent; a typed 500 verdict is transient regardless of wording.
			const error = apiCallError({ statusCode: 500, message: "billing hard failure" })
			expect(classifyFailureForRetry({ error })).toEqual({ retryable: true })
		})
	})

	describe("permanent by default", () => {
		it("does not retry request, auth, billing, and other non-retryable statuses", () => {
			for (const statusCode of [400, 401, 402, 403, 404, 422, 501]) {
				expect(classifyFailureForRetry({ error: apiCallError({ statusCode }) })).toEqual({ retryable: false })
			}
		})

		it("does not retry an unmatched error — no matter the message", () => {
			const errors: unknown[] = [
				new Error("some novel provider failure"),
				new Error("prompt is too long"), // overflow text without typed class
				new Error("insufficient_quota: check your plan and billing"),
				"just a string",
				{ statusCode: "not-a-number" },
				null,
			]
			for (const error of errors) {
				expect(classifyFailureForRetry({ error })).toEqual({ retryable: false })
			}
		})

		it("does not retry a typed context-window overflow, even with a transient-looking status", () => {
			const error = apiCallError({ statusCode: 429 })
			expect(classifyFailureForRetry({ error, errorClass: "context_window_exceeded" })).toEqual({
				retryable: false,
			})
		})

		it("does not retry aborts (user cancellation)", () => {
			const byName = new Error("The operation was aborted")
			byName.name = "AbortError"
			const byCode = apiCallError({ code: "ABORT_ERR" })
			expect(classifyFailureForRetry({ error: byName })).toEqual({ retryable: false })
			expect(classifyFailureForRetry({ error: byCode })).toEqual({ retryable: false })
		})
	})

	describe("Retry-After", () => {
		it("honors a seconds value alongside a retryable status", () => {
			const error = apiCallError({ statusCode: 429, responseHeaders: { "retry-after": "120" } })
			expect(classifyFailureForRetry({ error })).toEqual({ retryable: true, retryAfterSeconds: 120 })
		})

		it("honors an HTTP-date value", () => {
			const error = apiCallError({
				statusCode: 503,
				responseHeaders: { "Retry-After": new Date(Date.now() + 60_000).toUTCString() },
			})
			const verdict = classifyFailureForRetry({ error })
			expect(verdict.retryable).toBe(true)
			if (verdict.retryable) {
				expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(59)
				expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(60)
			}
		})

		it("clamps tiny and huge values into the retry window", () => {
			expect(readRetryAfterSeconds({ "retry-after": "0" })).toBe(1)
			expect(readRetryAfterSeconds({ "retry-after": "999999" })).toBe(MAX_RETRY_DELAY_SECONDS)
		})

		it("ignores garbage values without affecting retryability", () => {
			expect(readRetryAfterSeconds({ "retry-after": "soon" })).toBeUndefined()
			expect(readRetryAfterSeconds({})).toBeUndefined()
			expect(readRetryAfterSeconds(null)).toBeUndefined()
			const error = apiCallError({ statusCode: 429, responseHeaders: { "retry-after": "soon" } })
			expect(classifyFailureForRetry({ error })).toEqual({ retryable: true })
		})
	})
})
