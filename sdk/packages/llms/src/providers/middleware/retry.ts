/**
 * Retry middleware for AI SDK providers.
 *
 * Implements automatic retry with exponential backoff for transient errors
 * (rate limits, server errors, network failures).
 */

import type {
	LanguageModelV3Middleware,
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

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetryAttempt" | "signal">> = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	retryAllErrors: false,
};

/**
 * Custom error class for retriable errors.
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
 */
export function isRetriableError(error: unknown): boolean {
	if (error instanceof RetriableError) {
		return true;
	}

	if (error && typeof error === "object") {
		const err = error as Record<string, unknown>;

		const status = err.status ?? err.statusCode;
		if (typeof status === "number") {
			if (status === 429 || (status >= 500 && status < 600)) {
				return true;
			}
		}

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
			];
			if (networkErrorCodes.includes(code)) {
				return true;
			}
		}

		const message = err.message;
		if (typeof message === "string") {
			const retriablePatterns = [
				/rate limit/i,
				/too many requests/i,
				/overloaded/i,
				/temporarily unavailable/i,
			];
			if (retriablePatterns.some((pattern) => pattern.test(message))) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Extract retry delay from error headers.
 */
export function getRetryDelayFromError(error: unknown): number | undefined {
	if (error instanceof RetriableError && error.retryAfterMs !== undefined) {
		return error.retryAfterMs;
	}

	if (!error || typeof error !== "object") {
		return undefined;
	}

	const err = error as Record<string, unknown>;
	const headers = err.headers as Record<string, string> | undefined;
	if (headers && typeof headers === "object") {
		const retryAfter =
			headers["retry-after"] ??
			headers["Retry-After"] ??
			headers["x-ratelimit-reset"];

		if (retryAfter) {
			const parsed = Number.parseInt(retryAfter, 10);
			if (!Number.isNaN(parsed)) {
				return parsed * 1000;
			}
		}
	}

	return undefined;
}

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoffDelay(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
): number {
	const exponentialDelay = baseDelayMs * 2 ** attempt;
	const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
	const delay = exponentialDelay + jitter;
	return Math.min(Math.max(0, delay), maxDelayMs);
}

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
					if (attempt > 0) {
						const headerDelay = getRetryDelayFromError(lastError);
						const backoffDelay = calculateBackoffDelay(
							attempt - 1,
							config.baseDelayMs,
							config.maxDelayMs,
						);
						const delayMs = headerDelay ?? backoffDelay;

						if (config.onRetryAttempt) {
							await config.onRetryAttempt(
								attempt,
								config.maxRetries,
								delayMs,
								lastError,
							);
						}

						await sleep(delayMs, options.signal);
					}

					return await doStream();
				} catch (error) {
					lastError = error;

					const isRetriable = config.retryAllErrors || isRetriableError(error);
					const hasRetriesLeft = attempt < config.maxRetries;

					if (!isRetriable || !hasRetriesLeft) {
						throw error;
					}
				}
			}

			throw lastError;
		},
	};
}

/**
 * Compose multiple middlewares into a single middleware.
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
