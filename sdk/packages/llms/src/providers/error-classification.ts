import { type ProviderErrorClass, safeJsonParse } from "@cline/shared";
import { AISDKError, APICallError, RetryError, TypeValidationError } from "ai";

/**
 * Provider codes that unambiguously identify a context-window overflow
 * (OpenAI-family `error.code`).
 */
const CONTEXT_WINDOW_CODES = new Set(["context_length_exceeded"]);

/**
 * Message shapes providers use for context-window overflow. Sourced from the
 * legacy extension's per-provider detectors (OpenAI, OpenRouter, Anthropic,
 * Cerebras, Bedrock, Vercel gateway / Alibaba Qwen) — the wire messages are
 * provider-authored and identical on the SDK arch; only the surrounding
 * error-object structure changed (handled by the signal walk below).
 */
const CONTEXT_WINDOW_PATTERNS = [
	/\bcontext\s*(?:length|window|limit)\b/i,
	/\bmaximum\s*context\b/i,
	/\b(?:input\s*)?tokens?\s+exceeds?\b/i,
	/\btoo\s*many\s*tokens?\b/i,
	/\binput\s+is\s+too\s+long\b/i,
	/\bprompt\s+is\s+too\s+long\b/i,
	/reduce\s+the\s+length\s+of\s+the\s+messages\s+or\s+completion/i,
	/requested\s+input\s+length\s+.*exceeds\s+.*maximum/i,
];

/**
 * Signals that the request failed for throughput/quota reasons rather than
 * size. Token-per-minute limit messages also talk about tokens being
 * "exceeded", so these veto a context-window match.
 */
const RATE_LIMIT_PATTERNS = [/rate[\s_-]?limit/i, /per[\s_-]?minute\b/i];

/** Overflow rejections arrive as invalid-request-family statuses. */
const CONTEXT_WINDOW_STATUSES = new Set([400, 413, 422]);
const RATE_LIMIT_STATUS = 429;
/**
 * Credential rejections. Status-only on purpose: matching message text
 * ("unauthorized", "forbidden") would misfire on provider bodies that merely
 * quote such words, and every provider that rejects credentials does say so
 * in the HTTP layer.
 */
const AUTH_STATUSES = new Set([401, 403]);

const MAX_WALK_DEPTH = 8;

/**
 * Object keys whose values carry further error detail — human-readable text
 * (message/detail/error_message; strings are recorded by the string branch)
 * or nested error structures the providers and gateways wrap around them.
 */
const DETAIL_KEYS = [
	"message",
	"detail",
	"error_message",
	"error",
	"errors",
	"cause",
	"responseBody",
	"data",
	"value",
	"param",
] as const;

/** Object keys that may carry an HTTP status. */
const STATUS_KEYS = ["status", "statusCode", "code"] as const;

interface ErrorSignals {
	messages: string[];
	statuses: Set<number>;
	codes: Set<string>;
}

function recordStatus(signals: ErrorSignals, value: unknown): void {
	const numeric =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d{3}$/.test(value.trim())
				? Number(value.trim())
				: undefined;
	if (numeric !== undefined && numeric >= 100 && numeric <= 599) {
		signals.statuses.add(numeric);
	}
}

function collectSignals(
	value: unknown,
	signals: ErrorSignals,
	visited: Set<unknown>,
	depth: number,
): void {
	if (value == null || depth > MAX_WALK_DEPTH) {
		return;
	}
	if (typeof value === "string") {
		const text = value.trim();
		if (!text) {
			return;
		}
		signals.messages.push(text);
		// Providers and gateways JSON-encode upstream rejections into message
		// strings (OpenRouter mid-stream errors, Vercel `value.error_message`);
		// parse so embedded status/code fields become structured signals.
		const parsed = safeJsonParse<unknown>(text);
		if (parsed !== undefined && typeof parsed === "object") {
			collectSignals(parsed, signals, visited, depth + 1);
		} else {
			// Not full JSON — still mine embedded `"code": 400` / `"status": 400`.
			const embedded = text.match(/"(?:code|status)"\s*:\s*"?(\d{3})"?/);
			if (embedded) {
				recordStatus(signals, embedded[1]);
			}
		}
		return;
	}
	if (typeof value !== "object") {
		return;
	}
	if (visited.has(value)) {
		return;
	}
	visited.add(value);

	if (Array.isArray(value)) {
		for (const item of value) {
			collectSignals(item, signals, visited, depth + 1);
		}
		return;
	}

	const record = value as Record<string, unknown>;
	for (const key of STATUS_KEYS) {
		recordStatus(signals, record[key]);
	}
	for (const key of ["code", "type", "name"]) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) {
			signals.codes.add(candidate.trim());
		}
	}
	for (const key of DETAIL_KEYS) {
		const nested = record[key];
		if (
			nested !== undefined &&
			nested !== value &&
			typeof nested !== "number"
		) {
			collectSignals(nested, signals, visited, depth + 1);
		}
	}
}

/**
 * Apply the detection rules to collected signals. Shared between the typed
 * AI SDK pre-pass and the structural walk so both paths classify identically:
 * a context-window verdict requires an overflow message pattern (or explicit
 * provider code), no rate-limit signal, and — when any HTTP status is
 * visible — an invalid-request-family status.
 */
function verdictFromSignals(signals: ErrorSignals): ProviderErrorClass {
	if ([...signals.codes].some((code) => CONTEXT_WINDOW_CODES.has(code))) {
		return "context_window_exceeded";
	}

	if ([...signals.statuses].some((status) => AUTH_STATUSES.has(status))) {
		return "auth";
	}

	if (signals.statuses.has(RATE_LIMIT_STATUS)) {
		return "unknown";
	}
	if (
		signals.messages.some((message) =>
			RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message)),
		)
	) {
		return "unknown";
	}
	if (
		signals.statuses.size > 0 &&
		![...signals.statuses].some((status) => CONTEXT_WINDOW_STATUSES.has(status))
	) {
		return "unknown";
	}
	if (
		signals.messages.some((message) =>
			CONTEXT_WINDOW_PATTERNS.some((pattern) => pattern.test(message)),
		)
	) {
		return "context_window_exceeded";
	}
	return "unknown";
}

function collectSignalsFrom(values: readonly unknown[]): ErrorSignals {
	const signals: ErrorSignals = {
		messages: [],
		statuses: new Set(),
		codes: new Set(),
	};
	const visited = new Set<unknown>();
	for (const value of values) {
		collectSignals(value, signals, visited, 0);
	}
	return signals;
}

/**
 * Classify errors that are real AI SDK error instances, using their typed
 * fields instead of guessing at shape. Returns `undefined` when the error is
 * not a recognized instance (or a typed wrapper leads nowhere), so the caller
 * falls back to the structural walk.
 *
 * `isInstance()` is the AI SDK's symbol-based guard, so it holds across
 * duplicated package copies — but it can never match gateway-forwarded plain
 * JSON payloads that merely *name* an AI SDK error (ENG-2394); those stay the
 * structural walk's job.
 */
function classifyTypedError(
	error: unknown,
	depth: number,
): ProviderErrorClass | undefined {
	if (depth > MAX_WALK_DEPTH) {
		return undefined;
	}
	// Specific classes before the generic guard — every AI SDK error
	// subclasses AISDKError, so the generic check would swallow them.
	if (RetryError.isInstance(error)) {
		// Only the final attempt decides the verdict: earlier attempts were
		// retried away (typically rate limits) and must neither veto nor fake
		// its classification — so an untyped final error is walked alone
		// rather than falling back to the whole wrapper's `errors` array.
		const last = error.lastError ?? error.errors[error.errors.length - 1];
		if (last == null) {
			return undefined;
		}
		return (
			classifyTypedError(last, depth + 1) ??
			verdictFromSignals(collectSignalsFrom([last]))
		);
	}
	if (APICallError.isInstance(error)) {
		// The typed statusCode is the sole authoritative status and gates the
		// whole verdict: nothing in the payload — not even an explicit
		// overflow code echoed inside a rate-limit or server-failure body —
		// out-votes the HTTP layer. Absent a statusCode, the payload decides.
		const status =
			typeof error.statusCode === "number" ? error.statusCode : undefined;
		if (status !== undefined && AUTH_STATUSES.has(status)) {
			return "auth";
		}
		if (status !== undefined && !CONTEXT_WINDOW_STATUSES.has(status)) {
			return "unknown";
		}
		const signals = collectSignalsFrom([
			error.message,
			error.responseBody,
			error.data,
		]);
		signals.statuses = new Set(status !== undefined ? [status] : []);
		return verdictFromSignals(signals);
	}
	if (TypeValidationError.isInstance(error)) {
		// `value` holds the payload that failed validation — for gateway
		// streams, the upstream provider rejection. Only a definitive verdict
		// counts; "unknown" defers to the caller's structural walk.
		const verdict = verdictFromSignals(collectSignalsFrom([error.value]));
		return verdict !== "unknown" ? verdict : undefined;
	}
	if (AISDKError.isInstance(error)) {
		const verdict = classifyTypedError(error.cause, depth + 1);
		return verdict !== undefined && verdict !== "unknown" ? verdict : undefined;
	}
	return undefined;
}

/**
 * Classify a raw provider error (or an already-flattened error message) into
 * a {@link ProviderErrorClass}. Call this where the structured error object
 * is still available — `extractErrorMessage` discards the structure this
 * classification relies on.
 *
 * Typed AI SDK error instances are classified first via their typed fields;
 * everything else — including plain JSON payloads that only *look* like AI
 * SDK errors — goes through the conservative structural walk.
 */
export function classifyProviderError(error: unknown): ProviderErrorClass {
	try {
		const typed = classifyTypedError(error, 0);
		if (typed !== undefined) {
			return typed;
		}
	} catch {
		// Fall through to the structural walk.
	}

	const signals: ErrorSignals = {
		messages: [],
		statuses: new Set(),
		codes: new Set(),
	};
	try {
		collectSignals(error, signals, new Set(), 0);
	} catch {
		return "unknown";
	}
	return verdictFromSignals(signals);
}

/**
 * HTTP statuses that are transient and retryable: request timeout / conflict /
 * too-early, rate limiting, and the 5xx server-failure family (incl. the
 * widely used 529 "overloaded"). This mirrors the AI SDK's own retry policy
 * and is the fallback only for errors that are not typed AI SDK instances;
 * typed errors defer to {@link APICallError.isRetryable}. Any other 4xx is the
 * caller's own request being rejected and must not be retried.
 */
const RETRYABLE_STATUSES = new Set([
	408, 409, 425, 429, 500, 502, 503, 504, 529,
]);

/**
 * The sole message fallback. OpenRouter forwards an upstream failure mid-stream
 * as a bare "Provider returned error" string with no HTTP status and no typed
 * error to inspect, so there is nothing else to key on. Every other decision
 * comes from the AI SDK's typed `isRetryable` flag or the HTTP status — not
 * from matching free-form message text.
 */
const PROVIDER_RETURNED_ERROR_PATTERN = /provider returned error/i;

/**
 * Retryability taken from a real AI SDK error instance via its own typed
 * `isRetryable` flag, rather than re-deriving it — the maintainable path that
 * stays correct as the SDK evolves. Returns `undefined` when the error is not
 * a recognized instance, so {@link isRetryableProviderError} falls back to the
 * structural walk.
 */
function isRetryableTypedError(
	error: unknown,
	depth: number,
): boolean | undefined {
	if (depth > MAX_WALK_DEPTH) {
		return undefined;
	}
	if (RetryError.isInstance(error)) {
		// The SDK already retried and gave up; only the final attempt decides
		// whether another attempt at our layer is worthwhile. Earlier attempts
		// were retried away (typically rate limits) and must not vote, so an
		// unclassifiable final error is judged structurally on its own rather
		// than by walking the whole wrapper.
		const last = error.lastError ?? error.errors[error.errors.length - 1];
		if (last == null) {
			return undefined;
		}
		return (
			isRetryableTypedError(last, depth + 1) ?? isRetryableFromSignals(last)
		);
	}
	if (APICallError.isInstance(error)) {
		return error.isRetryable === true;
	}
	if (AISDKError.isInstance(error)) {
		return isRetryableTypedError(error.cause, depth + 1);
	}
	return undefined;
}

/**
 * Structural retryability for a value that is not a typed AI SDK error: a
 * flattened message, a gateway-forwarded JSON payload, or the final attempt
 * inside a RetryError. HTTP status decides first; message text only for the
 * one documented statusless provider quirk.
 */
function isRetryableFromSignals(value: unknown): boolean {
	const signals: ErrorSignals = {
		messages: [],
		statuses: new Set(),
		codes: new Set(),
	};
	try {
		collectSignals(value, signals, new Set(), 0);
	} catch {
		return false;
	}

	const statuses = [...signals.statuses];
	// Never retry credential rejections or a definitive context-window overflow:
	// the same request will fail again.
	if (statuses.some((status) => AUTH_STATUSES.has(status))) {
		return false;
	}
	if ([...signals.codes].some((code) => CONTEXT_WINDOW_CODES.has(code))) {
		return false;
	}
	// A transient HTTP status (incl. any 5xx) is retryable.
	if (
		statuses.some(
			(status) =>
				RETRYABLE_STATUSES.has(status) || (status >= 500 && status <= 599),
		)
	) {
		return true;
	}
	// Any other visible 4xx is a non-retryable client error.
	if (statuses.some((status) => status >= 400 && status < 500)) {
		return false;
	}
	// No typed error and no status: the one provider quirk we special-case.
	return signals.messages.some((message) =>
		PROVIDER_RETURNED_ERROR_PATTERN.test(message),
	);
}

/**
 * Decide whether a provider/API error is a transient failure worth retrying
 * with backoff, as opposed to a permanent failure a retry cannot fix
 * (credential rejections, context-window overflow, other client-side 4xx
 * errors). Prefers the AI SDK's own typed `isRetryable` signal; for
 * non-instances (already-flattened messages or gateway-forwarded JSON) it
 * falls back to the HTTP status, and finally to the single documented
 * "Provider returned error" provider quirk. Accepts either a raw structured
 * error or a flattened message string.
 */
export function isRetryableProviderError(error: unknown): boolean {
	// Prefer the AI SDK's own typed retryability signal.
	try {
		const typed = isRetryableTypedError(error, 0);
		if (typed !== undefined) {
			return typed;
		}
	} catch {
		// Fall through to the structural walk.
	}

	return isRetryableFromSignals(error);
}

/**
 * Retryability as seen by the agent loop's turn-level retry, which must not
 * stack on retries another layer already spent. The AI SDK owns request-start
 * failures: it retries them itself with `retry-after`-aware backoff and, once
 * exhausted, surfaces a `RetryError`. Re-running such a turn would multiply
 * the SDK's attempts by the agent's, so a `RetryError` is terminal here even
 * when its final attempt looks transient. Everything else (most importantly a
 * provider error emitted mid-stream, which the SDK never retries) is judged by
 * {@link isRetryableProviderError}.
 */
export function isRetryableBeyondSdkRetries(error: unknown): boolean {
	// Guarded like the other typed checks: `RetryError.isInstance` throws when
	// the "ai" module is only partially available (tests mock it with a subset
	// of exports), and the classifier below is the correct fallback then.
	try {
		if (RetryError.isInstance(error)) {
			return false;
		}
	} catch {
		// Fall through to the classifier.
	}
	return isRetryableProviderError(error);
}
