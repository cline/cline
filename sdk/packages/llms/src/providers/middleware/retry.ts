/**
 * Retry middleware for AI SDK providers.
 *
 * Implements automatic retry with exponential backoff for transient errors
 * (rate limits, server errors, network failures). This middleware wraps
 * the `doStream` call and retries on retriable errors before propagating
 * failures to the caller.
 *
 * Retry behavior:
 *   - 429 (Rate Limit): Always retried, respects `retry-after` header
 *   - 5xx (Server Error): Retried with exponential backoff
 *   - Network errors: Retried (ECONNRESET, ETIMEDOUT, etc.)
 *   - 4xx (Client Error): NOT retried (except 429)
 *
 * The middleware integrates with the existing `onRetryAttempt` callback
 * in ProviderConfig, allowing callers to track retry attempts for
 * telemetry or user notification.
 */

import type {
	LanguageModelV3Middleware,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries?: number;
	/** Base delay in milliseconds for exponential backoff (default: 1000) */
	baseDelayMs?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelayMs?: number;
	/** Retry all errors, not just retriable ones (default: false) */
	retryAllErrors?: boolean;
	/** Callback invoked before each retry attempt */
	onRetryAttempt?: (
		attempt: number,
		maxRetries: number,
		delayMs: number,
		error: unknown,
	) => void | Promise<void>;
	/** AbortSignal to cancel retries */
	signal?: AbortSignal;
}

const DEFAULT_OPTIONS: Required<
	Omit<RetryOptions, "onRetryAttempt" | "signal">
> = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	retryAllErrors: false,
};

/**
 * Custom error class for retriable errors.
 * Allows explicit marking of errors that should trigger retry logic.
 */
export class RetriableError extends Error {
	readonly status: number;
	readonly retryAfterMs?: number;

	constructor(message: string, status = 429, retryAfterMs?: number) {
		super(message);
		this.name = "RetriableError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

/**
 * Determine if an error is retriable.
 *
 * Retriable errors include:
 *   - 429 Too Many Requests (rate limit)
 *   - 5xx Server Errors (500, 502, 503, 504)
 *   - Network errors (connection reset, timeout)
 *   - RetriableError instances
 */
export function isRetriableError(error: unknown): boolean {
	if (error instanceof RetriableError) {
		return true;
	}

	if (error && typeof error === "object") {
		const err = error as Record<string, unknown>;

		// Check HTTP status codes
		const status = err.status ?? err.statusCode;
		if (typeof status === "number") {
			// 429 = rate limit, 5xx = server errors
			if (status === 429 || (status >= 500 && status < 600)) {
				return true;
			}
		}

		// Check for network errors by code
		const code = err.code;
		if (typeof code === "string") {
			const networkErrorCodes = [
				"ECONNRESET",
				"ECONNREFUSED",
				"ETIMEDOUT",
				"ENOTFOUND",
				"EAI_AGAIN",
				"EPIPE",
				"EHOSTUNREACH",
				"ENETUNREACH",
				"UND_ERR_CONNECT_TIMEOUT",
				"UND_ERR_SOCKET",
			];
			if (networkErrorCodes.includes(code)) {
				return true;
			}
		}

		// Check for fetch/network error types
		const name = err.name;
		if (typeof name === "string") {
			if (name === "FetchError" || name === "AbortError") {
				return true;
			}
		}

		// Check error message for common patterns
		const message = err.message;
		if (typeof message === "string") {
			const retriablePatterns = [
				/rate limit/i,
				/too many requests/i,
				/overloaded/i,
				/capacity/i,
				/temporarily unavailable/i,
				/service unavailable/i,
				/gateway timeout/i,
				/bad gateway/i,
				/internal server error/i,
			];
			if (retriablePatterns.some((pattern) => pattern.test(message))) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Extract retry delay from error headers or response.
 *
 * Checks common rate limit headers:
 *   - retry-after (standard)
 *   - x-ratelimit-reset (common extension)
 *   - ratelimit-reset (alternative)
 *
 * Handles both delta-seconds and Unix timestamp formats.
 */
export function getRetryDelayFromError(error: unknown): number | undefined {
	if (error instanceof RetriableError && error.retryAfterMs !== undefined) {
		return error.retryAfterMs;
	}

	if (!error || typeof error !== "object") {
		return undefined;
	}

	const err = error as Record<string, unknown>;

	// Check headers object
	const headers = err.headers as Record<string, string> | undefined;
	if (headers && typeof headers === "object") {
		const retryAfter =
			headers["retry-after"] ??
			headers["Retry-After"] ??
			headers["x-ratelimit-reset"] ??
			headers["X-RateLimit-Reset"] ??
			headers["ratelimit-reset"] ??
			headers["RateLimit-Reset"];

		if (retryAfter) {
			return parseRetryAfter(retryAfter);
		}
	}

	// Check retryAfter property directly
	if (typeof err.retryAfter === "number") {
		return err.retryAfter * 1000;
	}
	if (typeof err.retryAfter === "string") {
		return parseRetryAfter(err.retryAfter);
	}

	return undefined;
}

/**
 * Parse retry-after header value to milliseconds.
 * Handles both delta-seconds and HTTP-date/Unix timestamp formats.
 */
function parseRetryAfter(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		// Try parsing as HTTP-date
		const date = Date.parse(value);
		if (!Number.isNaN(date)) {
			return Math.max(0, date - Date.now());
		}
		return undefined;
	}

	// If value is large, treat as Unix timestamp; otherwise delta-seconds
	const now = Date.now();
	const threshold = now / 1000 - 86400; // 1 day ago in seconds
	if (parsed > threshold) {
		// Unix timestamp (seconds)
		return Math.max(0, parsed * 1000 - now);
	}

	// Delta seconds
	return parsed * 1000;
}

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoffDelay(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
): number {
	// Exponential backoff: base * 2^attempt
	const exponentialDelay = baseDelayMs * 2 ** attempt;
	// Add jitter (±25%) to prevent thundering herd
	const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
	const delay = exponentialDelay + jitter;
	// Clamp to max delay
	return Math.min(Math.max(0, delay), maxDelayMs);
}

/**
 * Sleep for the specified duration, respecting abort signal.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		throw new Error("Retry aborted");
	}

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);

		if (signal) {
			const onAbort = () => {
				clearTimeout(timeout);
				reject(new Error("Retry aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

/**
 * Create a retry middleware with the specified options.
 *
 * Usage:
 * ```ts
 * import { wrapLanguageModel } from "ai";
 * import { createRetryMiddleware } from "./middleware/retry";
 *
 * const model = wrapLanguageModel({
 *   model: provider(modelId),
 *   middleware: createRetryMiddleware({
 *     maxRetries: 3,
 *     onRetryAttempt: (attempt, max, delay, error) => {
 *       console.log(`Retry ${attempt}/${max} after ${delay}ms`);
 *     },
 *   }),
 * });
 * ```
 */
export function createRetryMiddleware(
	options: RetryOptions = {},
): LanguageModelV3Middleware {
	const config = { ...DEFAULT_OPTIONS, ...options };

	return {
		specificationVersion: "v3",

		wrapStream: async ({ doStream }) => {
			let lastError: unknown;

			for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
				try {
					// If this is a retry attempt, we've already caught an error
					if (attempt > 0) {
						// Calculate delay
						const headerDelay = getRetryDelayFromError(lastError);
						const backoffDelay = calculateBackoffDelay(
							attempt - 1,
							config.baseDelayMs,
							config.maxDelayMs,
						);
						const delayMs = headerDelay ?? backoffDelay;

						// Notify callback
						if (config.onRetryAttempt) {
							await config.onRetryAttempt(
								attempt,
								config.maxRetries,
								delayMs,
								lastError,
							);
						}

						// Wait before retry
						await sleep(delayMs, options.signal);
					}

					// Attempt the stream call
					const result = await doStream();

					// Wrap the stream to catch errors during iteration
					const originalStream = result.stream;
					const wrappedStream = wrapStreamWithRetry(
						originalStream,
						async (streamError) => {
							// If error occurs during streaming and is retriable,
							// we can't easily retry mid-stream, so just propagate
							// This is a limitation - full retry would need request replay
							throw streamError;
						},
					);

					return {
						...result,
						stream: wrappedStream,
					};
				} catch (error) {
					lastError = error;

					// Check if we should retry
					const isRetriable = config.retryAllErrors || isRetriableError(error);
					const hasRetriesLeft = attempt < config.maxRetries;

					if (!isRetriable || !hasRetriesLeft) {
						throw error;
					}

					// Continue to next iteration for retry
				}
			}

			// Should not reach here, but throw last error if we do
			throw lastError;
		},
	};
}

/**
 * Wrap an async iterable stream to handle errors during iteration.
 */
async function* wrapStreamWithRetry(
	stream: AsyncIterable<LanguageModelV3StreamPart>,
	onError: (error: unknown) => Promise<void>,
): AsyncIterable<LanguageModelV3StreamPart> {
	try {
		for await (const part of stream) {
			yield part;
		}
	} catch (error) {
		await onError(error);
	}
}

/**
 * Compose multiple middlewares into a single middleware.
 * Middlewares are applied in order (first middleware wraps outermost).
 */
export function composeMiddleware(
	...middlewares: LanguageModelV3Middleware[]
): LanguageModelV3Middleware {
	return {
		specificationVersion: "v3",

		transformParams: async (args) => {
			let params = args.params;
			for (const middleware of middlewares) {
				if (middleware.transformParams) {
					params = await middleware.transformParams({
						...args,
						params,
					});
				}
			}
			return params;
		},

		wrapStream: async (args) => {
			let doStream = args.doStream;

			// Apply middlewares in reverse order so first middleware is outermost
			for (let i = middlewares.length - 1; i >= 0; i--) {
				const middleware = middlewares[i];
				if (middleware.wrapStream) {
					const currentDoStream = doStream;
					const wrapFn = middleware.wrapStream;
					const wrappedDoStream = async () => {
						return wrapFn({
							...args,
							doStream: currentDoStream,
						});
					};
					doStream = wrappedDoStream;
				}
			}

			return doStream();
		},
	};
}

/**
 * Default retry middleware instance with standard options.
 * Use `createRetryMiddleware()` for custom configuration.
 */
export const retryMiddleware = createRetryMiddleware();
