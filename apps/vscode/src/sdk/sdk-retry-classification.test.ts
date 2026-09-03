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
			for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_SOCKET"]) {
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

		it("lets HTTP metadata outrank message text (no substring veto over typed verdicts)", () => {
			// A typed 500 verdict is transient regardless of wording — even when
			// the body mentions billing.
			const error = apiCallError({ statusCode: 500, message: "billing hard failure" })
			expect(classifyFailureForRetry({ error })).toEqual({ retryable: true })
		})
	})

	describe("retryable by default — external failures without typed metadata", () => {
		it("retries the flattened z.ai DNS failure verbatim (string and Error forms)", () => {
			const text = "Cannot connect to API: getaddrinfo EAI_AGAIN api.z.ai: getaddrinfo EAI_AGAIN api.z.ai (EAI_AGAIN)"
			// Providers stringify transport failures; the turn pipeline also
			// flattens `error` to a display string before the retry boundary.
			expect(classifyFailureForRetry({ error: text })).toEqual({ retryable: true })
			expect(classifyFailureForRetry({ error: new Error(text) })).toEqual({ retryable: true })
			expect(classifyFailureForRetry({ error: text, errorClass: "unknown" })).toEqual({ retryable: true })
		})

		it("retries novel and unrecognized provider errors — no permanent default", () => {
			for (const error of [
				new Error("some novel provider failure"),
				new Error("The model is overloaded"),
				"just a string",
				{ statusCode: "not-a-number" },
				null,
			] as unknown[]) {
				expect(classifyFailureForRetry({ error })).toEqual({ retryable: true })
			}
		})

		it("retries throughput limit text even when it mentions tokens", () => {
			for (const message of [
				"Rate limit reached for tokens per minute",
				"Tokens per minute limit exceeded, please retry",
			]) {
				expect(classifyFailureForRetry({ error: new Error(message) })).toEqual({ retryable: true })
			}
		})
	})

	describe("permanent only for proven unfixable causes", () => {
		it("does not retry request, auth, billing, and other non-retryable statuses", () => {
			for (const statusCode of [400, 401, 402, 403, 404, 422, 501]) {
				expect(classifyFailureForRetry({ error: apiCallError({ statusCode }) })).toEqual({ retryable: false })
			}
		})

		it("does not retry the typed auth error class (HTTP 401/403 verdict)", () => {
			expect(classifyFailureForRetry({ error: apiCallError({ statusCode: 500 }), errorClass: "auth" })).toEqual({
				retryable: false,
			})
		})

		it("does not retry a typed context-window overflow, even with a transient-looking status", () => {
			const error = apiCallError({ statusCode: 429 })
			expect(classifyFailureForRetry({ error, errorClass: "context_window_exceeded" })).toEqual({
				retryable: false,
			})
		})

		it("does not retry flattened context-overflow messages", () => {
			for (const message of [
				"prompt is too long",
				"This model's maximum context length is 16385 tokens. However, you requested 20000 tokens",
				"input tokens exceed the maximum allowed",
				"context_length_exceeded",
			]) {
				expect(classifyFailureForRetry({ error: new Error(message) })).toEqual({ retryable: false })
			}
		})

		it("does not retry flattened credential-rejection messages", () => {
			for (const message of [
				"Invalid API key provided",
				"incorrect api key provided: sk-foo***",
				"invalid x-api-key",
				"Unauthorized — the request requires valid credentials",
				"authentication_error: invalid credentials",
				"No auth credentials found",
			]) {
				expect(classifyFailureForRetry({ error: new Error(message) })).toEqual({ retryable: false })
			}
		})

		it("does not retry flattened billing/quota hard-failure messages", () => {
			for (const message of [
				"insufficient_quota: check your plan and billing details",
				"You exceeded your current quota, please check your plan",
				"credit balance too low",
				"Payment required: add credits to continue",
			]) {
				expect(classifyFailureForRetry({ error: new Error(message) })).toEqual({ retryable: false })
			}
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
