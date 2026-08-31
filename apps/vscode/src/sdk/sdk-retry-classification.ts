import type { ProviderErrorClass } from "@cline/shared"

import { MAX_RETRY_DELAY_SECONDS } from "./sdk-api-retry-coordinator"

/**
 * Classification of a failed agent turn for the auto-retry policy.
 *
 * `retryable` is decided exclusively from typed metadata (HTTP status codes,
 * the AI SDK's `isRetryable` flag, transport error codes/names, and
 * `Retry-After` headers). Anything that carries no recognizable transient
 * signal — including unfamiliar 4xx, auth, billing, and provider errors — is
 * permanent: an unmatched error must never be retried without a limit.
 */
export type RetryClassification = { retryable: false } | { retryable: true; retryAfterSeconds?: number }

/** A failed turn as seen at the retry boundary. */
export interface TurnFailure {
	error: unknown
	/** Typed provider classification from the SDK, when known. */
	errorClass?: ProviderErrorClass
}

/** HTTP statuses where retrying the same request can plausibly succeed. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

/**
 * Node/undici error `code`s (and error `name`s) that identify a transport-level
 * failure — the request never produced a provider verdict, so it is safe to
 * send again.
 */
const TRANSPORT_ERROR_CODES = new Set([
	"ECONNRESET",
	"ECONNREFUSED",
	"ECONNABORTED",
	"ETIMEDOUT",
	"EPIPE",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
])
const TRANSPORT_ERROR_NAMES = new Set(["ConnectTimeoutError", "SocketError", "HeadersTimeoutError"])

/** How deep to walk error `cause` chains looking for typed metadata. */
const MAX_CAUSE_DEPTH = 6

interface TypedErrorSignals {
	statusCode?: number
	isRetryable?: boolean
	retryAfterSeconds?: number
	transportError: boolean
}

/**
 * Classify a failed turn for retry policy. Only typed metadata can mark an
 * error retryable; the default verdict for anything unmatched is permanent.
 */
export function classifyFailureForRetry(failure: TurnFailure): RetryClassification {
	if (failure.errorClass === "context_window_exceeded") {
		// Typed SDK classification: the prompt itself is too large. Retrying
		// the identical request can never succeed.
		return { retryable: false }
	}
	if (isAbortError(failure.error)) {
		return { retryable: false }
	}

	const signals = collectTypedSignals(failure.error, 0)
	if (signals.transportError) {
		return { retryable: true }
	}
	if (signals.isRetryable === true) {
		// Typed AI SDK flag (APICallError / GatewayError): the provider stack
		// already decided the request is safe to repeat.
		return withRetryAfter(signals)
	}
	if (signals.statusCode !== undefined && RETRYABLE_STATUSES.has(signals.statusCode)) {
		return withRetryAfter(signals)
	}
	return { retryable: false }
}

function withRetryAfter(signals: TypedErrorSignals): RetryClassification {
	return {
		retryable: true,
		...(signals.retryAfterSeconds !== undefined ? { retryAfterSeconds: signals.retryAfterSeconds } : {}),
	}
}

function collectTypedSignals(error: unknown, depth: number): TypedErrorSignals {
	const signals: TypedErrorSignals = { transportError: false }
	visit(error, signals, new Set(), depth)
	return signals
}

function visit(value: unknown, signals: TypedErrorSignals, visited: Set<unknown>, depth: number): void {
	if (value == null || depth > MAX_CAUSE_DEPTH || typeof value !== "object" || visited.has(value)) {
		return
	}
	visited.add(value)

	const record = value as Record<string, unknown>

	if (typeof record.code === "string" && TRANSPORT_ERROR_CODES.has(record.code)) {
		signals.transportError = true
	}
	if (typeof record.name === "string" && TRANSPORT_ERROR_NAMES.has(record.name)) {
		signals.transportError = true
	}

	// First status found on the walk wins: wrapper layers without a status of
	// their own are transparent, so this resolves to the actual HTTP verdict.
	if (signals.statusCode === undefined) {
		signals.statusCode = readStatusCode(record)
	}

	if (signals.isRetryable !== true && record.isRetryable === true) {
		signals.isRetryable = true
	}

	if (signals.retryAfterSeconds === undefined) {
		signals.retryAfterSeconds = readRetryAfterSeconds(record.responseHeaders ?? record.headers)
	}

	if (record.cause !== undefined) {
		visit(record.cause, signals, visited, depth + 1)
	}
	// The AI SDK's RetryError keeps its attempts in `errors`; the final
	// attempt carries the authoritative verdict.
	if (record.lastError !== undefined && record.lastError !== value) {
		visit(record.lastError, signals, visited, depth + 1)
	}
}

function readStatusCode(record: Record<string, unknown>): number | undefined {
	for (const key of ["statusCode", "status"]) {
		const value = record[key]
		if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
			return value
		}
	}
	return undefined
}

/**
 * Parse a `Retry-After` header value ("120" seconds or an HTTP-date) into a
 * delay, clamped to the retry window. Returns undefined when absent or
 * unparseable.
 */
export function readRetryAfterSeconds(headers: unknown): number | undefined {
	if (typeof headers !== "object" || headers == null) {
		return undefined
	}
	const record = headers as Record<string, unknown>
	const raw = record["retry-after"] ?? record["Retry-After"]
	if (typeof raw !== "string" || !raw.trim()) {
		return undefined
	}
	const trimmed = raw.trim()
	const seconds = Number(trimmed)
	let delaySeconds: number | undefined
	if (Number.isFinite(seconds) && trimmed !== "") {
		delaySeconds = seconds
	} else {
		const date = Date.parse(trimmed)
		if (Number.isFinite(date)) {
			delaySeconds = (date - Date.now()) / 1000
		}
	}
	if (delaySeconds === undefined) {
		return undefined
	}
	return Math.min(Math.max(Math.ceil(delaySeconds), 1), MAX_RETRY_DELAY_SECONDS)
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === "AbortError" || (error as Error & { code?: unknown }).code === "ABORT_ERR")
}
