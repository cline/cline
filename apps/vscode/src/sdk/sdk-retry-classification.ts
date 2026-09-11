import type { ProviderErrorClass } from "@cline/shared"

import { MAX_RETRY_DELAY_SECONDS } from "./sdk-api-retry-coordinator"

/**
 * Classification of a failed agent turn for the auto-retry policy.
 *
 * The default verdict is RETRYABLE: any failure with an external cause that
 * Cline cannot fix itself (DNS outages, refused/dropped connections, provider
 * downtime, novel provider errors) rides the unlimited Fibonacci schedule.
 * A failure is permanent only when something provably needs user action or can
 * never succeed on retry — a typed auth/context-window class, a definitive
 * non-retryable HTTP status, an abort, or (absent any typed metadata) a
 * flattened message that definitively matches a credential, billing,
 * context-overflow, or request-validation signature. Providers like z.ai
 * stringify transport failures into plain text ("Cannot connect to API:
 * getaddrinfo EAI_AGAIN …"), leaving no typed metadata, which is exactly why
 * the default must be retryable.
 *
 * Typed metadata outranks message text — with one exception: a definitive
 * never-succeeds text verdict (request-validation, context-overflow,
 * credential) also vetoes status-derived wrapper signals (retryable HTTP
 * statuses and the AI SDK's isRetryable flag), because gateways forward
 * upstream request rejections under 5xx/429 labels while resending the
 * identical payload can never validate. See the veto in
 * classifyFailureForRetry.
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
	"EAI_FAIL",
	"ENOTFOUND",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
])
const TRANSPORT_ERROR_NAMES = new Set(["ConnectTimeoutError", "SocketError", "HeadersTimeoutError"])

/**
 * Throughput signatures: token-per-minute limits also talk about tokens being
 * "exceeded", so they veto the context-overflow patterns below (a rate limit
 * is transient; an oversized prompt is not).
 */
const THROUGHPUT_PATTERNS = [/rate[\s_-]?limit/i, /per[\s_-]?minute\b/i]

/**
 * Flattened-message signatures for failures a retry can never fix. Only
 * consulted when no typed metadata exists at all; mirrors the SDK's provider
 * error classification (sdk/packages/llms error-classification) so both
 * layers reach the same verdict on the same wire text.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
	/\bcontext[\s_-]*(?:length|window|limit)/i,
	/\bmaximum[\s_-]*context\b/i,
	/\b(?:input[\s_-]*)?tokens?[\s_-]+exceeds?\b/i,
	/\btoo[\s_-]*many[\s_-]*tokens?\b/i,
	/\binput[\s_-]*is[\s_-]*too[\s_-]*long\b/i,
	/\bprompt[\s_-]*is[\s_-]*too[\s_-]*long\b/i,
	/reduce[\s_-]*the[\s_-]*length[\s_-]*of[\s_-]*the[\s_-]*messages/i,
	/requested[\s_-]*input[\s_-]*length\b.{0,60}exceeds/is,
]
const CREDENTIAL_PATTERNS = [
	/\b(?:invalid|incorrect|missing|expired|revoked|not[\s_-]?valid|no)\b[^\n]{0,24}\b(?:x-)?api[\s_-]?key\b/i,
	/\bapi[\s_-]?key\b[^\n]{0,24}\b(?:invalid|incorrect|expired|missing|revoked|not[\s_-]?valid)\b/i,
	/\bunauthorized\b/i,
	/\bauthentication[\s_-]*(?:error|fail)/i,
	/\bno[\s_-]*auth[\s_-]*credentials\b/i,
	/\baccess[\s_-]*token\b[^\n]{0,24}\b(?:invalid|expired|revoked)\b/i,
]
const BILLING_PATTERNS = [
	/\binsufficient[\s_-]?quota\b/i,
	/\bexceeded[\s_-]*your[\s_-]*current[\s_-]*quota\b/i,
	/\bbilling\b/i,
	/\bcredit[\s_-]*balance\b/i,
	/\bpayment[\s_-]*(?:required|failed|declined)\b/i,
	/\bupgrade[\s_-]*your[\s_-]*plan\b/i,
]
/**
 * Flattened-message signatures for request-shape validation failures. A
 * definitive verdict about the request's own structure — an unsupported
 * content-block type, an invalid field, Anthropic's invalid_request_error —
 * is deterministic: resending the identical payload can never succeed, so
 * only the user can resolve it (drop the offending content, switch model,
 * or start a new task). Anthropic-compatible gateways (z.ai et al.) flatten
 * these 400s into plain text with no status metadata, which is why they must
 * be matched here rather than relying on the HTTP ladder.
 */
const REQUEST_VALIDATION_PATTERNS = [
	/\binvalid_request_error\b/i,
	/\bis invalid,? allowed values?:/i,
	/\bmessages\.[^\s:]{0,40}(?:type|role)\b[^\n]{0,80}\binvalid\b/i,
	/\b(?:unsupported|not[ _-]?allowed)[^\n]{0,40}\bcontent[ _-]?type\b/i,
]
const PERMANENT_MESSAGE_PATTERNS = [
	...CONTEXT_OVERFLOW_PATTERNS,
	...CREDENTIAL_PATTERNS,
	...BILLING_PATTERNS,
	...REQUEST_VALIDATION_PATTERNS,
]

/**
 * The permanent families definitive enough to veto status-derived typed
 * signals (see the veto in classifyFailureForRetry): a deterministic verdict
 * about the request cannot be un-made by the wrapper status a gateway slaps
 * on it. Billing is deliberately excluded — `\bbilling\b` is loose enough to
 * appear in transient internal-error bodies ("billing service unavailable") —
 * so it only applies when no typed metadata exists at all.
 */
const NEVER_SUCCEEDS_TEXT_PATTERNS = [...CONTEXT_OVERFLOW_PATTERNS, ...CREDENTIAL_PATTERNS, ...REQUEST_VALIDATION_PATTERNS]

/** How deep to walk error `cause` chains looking for typed metadata. */
const MAX_CAUSE_DEPTH = 6

interface TypedErrorSignals {
	/** Every HTTP status seen on the walk (first-hand provider verdicts). */
	statuses: Set<number>
	isRetryable?: boolean
	retryAfterSeconds?: number
	transportError: boolean
	/** Human-readable error text collected from the walk. */
	messages: string[]
}

/**
 * Classify a failed turn for retry policy. Retryable is the default — see the
 * module doc; only a proven user-action/never-succeeds verdict is permanent.
 */
export function classifyFailureForRetry(failure: TurnFailure): RetryClassification {
	if (failure.errorClass === "context_window_exceeded") {
		// Typed SDK classification: the prompt itself is too large. Retrying
		// the identical request can never succeed.
		return { retryable: false }
	}
	if (failure.errorClass === "auth") {
		// Typed SDK classification (HTTP 401/403): the provider rejected the
		// credentials. Only the user can fix this; retries cannot.
		return { retryable: false }
	}
	if (isAbortError(failure.error)) {
		return { retryable: false }
	}

	const signals = collectTypedSignals(failure.error, 0)
	if (signals.transportError) {
		return { retryable: true }
	}
	// Wrapper-status veto: gateways (z.ai's included) forward upstream request
	// rejections under transient labels — HTTP 500/502/503/429 — and the AI
	// SDK derives its `isRetryable` flag from that same wrapper status. A
	// definitive never-succeeds text verdict outranks both, because resending
	// the identical payload can never validate no matter how it is labeled.
	// Throughput text keeps precedence over the veto (a rate-limit body can
	// quote request parameters); transport failures were already handled
	// above and carry no provider verdict at all.
	const hasThroughputText = signals.messages.some((message) => THROUGHPUT_PATTERNS.some((pattern) => pattern.test(message)))
	if (
		!hasThroughputText &&
		signals.messages.some((message) => NEVER_SUCCEEDS_TEXT_PATTERNS.some((pattern) => pattern.test(message)))
	) {
		return { retryable: false }
	}
	if (signals.isRetryable === true) {
		// Typed AI SDK flag (APICallError / GatewayError): the provider stack
		// already decided the request is safe to repeat.
		return withRetryAfter(signals)
	}
	if (signals.statuses.size > 0) {
		// The provider returned a definitive HTTP verdict; text never
		// overrides it.
		const retryableStatus = [...signals.statuses].find((status) => RETRYABLE_STATUSES.has(status))
		return retryableStatus !== undefined ? withRetryAfter(signals) : { retryable: false }
	}
	// No typed metadata at all — the failure arrived flattened to text (or is
	// novel). Text can only exclude a retry; everything else is presumed
	// externally caused and rides the retry schedule.
	if (signals.messages.some((message) => THROUGHPUT_PATTERNS.some((pattern) => pattern.test(message)))) {
		return { retryable: true }
	}
	if (signals.messages.some((message) => PERMANENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message)))) {
		return { retryable: false }
	}
	return { retryable: true }
}

function withRetryAfter(signals: TypedErrorSignals): RetryClassification {
	return {
		retryable: true,
		...(signals.retryAfterSeconds !== undefined ? { retryAfterSeconds: signals.retryAfterSeconds } : {}),
	}
}

function collectTypedSignals(error: unknown, depth: number): TypedErrorSignals {
	const signals: TypedErrorSignals = { statuses: new Set(), transportError: false, messages: [] }
	if (typeof error === "string" && error.trim()) {
		// Fully flattened failures (some providers/runtimes reduce the error to
		// its display text before the retry boundary ever sees it).
		signals.messages.push(error)
	}
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

	for (const key of ["statusCode", "status"]) {
		const value = record[key]
		if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
			signals.statuses.add(value)
		}
	}

	if (signals.isRetryable !== true && record.isRetryable === true) {
		signals.isRetryable = true
	}

	if (signals.retryAfterSeconds === undefined) {
		signals.retryAfterSeconds = readRetryAfterSeconds(record.responseHeaders ?? record.headers)
	}

	for (const key of ["message", "responseBody", "detail"]) {
		const text = record[key]
		if (typeof text === "string" && text.trim() && !signals.messages.includes(text)) {
			signals.messages.push(text)
		}
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
