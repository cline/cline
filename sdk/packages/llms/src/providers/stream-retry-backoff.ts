import { RetryError, ToolChoiceViolationError } from "ai";
import { classifyProviderError } from "./error-classification";
import { isTransientNetworkError } from "./middleware/retry-empty-response";

export interface StreamRetryBackoffOptions {
	/** Wait before the first re-dial; doubles for each later one. */
	baseDelayMs?: number;
	maxDelayMs?: number;
}

export const DEFAULT_STREAM_RETRY_BASE_DELAY_MS = 1_000;
export const DEFAULT_STREAM_RETRY_MAX_DELAY_MS = 8_000;

export interface StreamRetryWait {
	/** 1-based index of the re-dial this wait precedes. */
	attempt: number;
	delayMs: number;
}

export interface StreamRetryBackoff {
	/** The AI SDK counts stream retries per model step. */
	startStep(): void;
	/**
	 * Record a provider error handed to `onError` and return the wait that
	 * should precede the AI SDK's next attempt, or undefined when no attempt
	 * follows it.
	 */
	onError(error: unknown): StreamRetryWait | undefined;
	/** Attributes for the terminal failure's telemetry. */
	summary(): { streamRetryAttempts: number; streamRetryWaitMs: number };
}

/**
 * Backoff for the AI SDK's in-stream retries (`streamRetries`), which re-dial
 * as soon as a provider error part arrives. The SDK awaits `onError` before
 * re-dialing, so the wait lives there: provider overloads mostly clear within
 * a few seconds, and an immediate re-dial meets the same overload.
 *
 * Errors that reach `onError` without a stream retry following them get no
 * wait: a `RetryError` (request-start retries exhausted), a transport failure
 * (the reader rejects, which ends the stream), and a tool-choice violation.
 * Credential and context-window failures reproduce on every attempt and keep
 * the immediate re-dial.
 */
export function createStreamRetryBackoff(
	maxRetries: number,
	options: StreamRetryBackoffOptions = {},
): StreamRetryBackoff {
	const baseDelayMs = Math.max(
		0,
		options.baseDelayMs ?? DEFAULT_STREAM_RETRY_BASE_DELAY_MS,
	);
	const maxDelayMs = Math.max(
		0,
		options.maxDelayMs ?? DEFAULT_STREAM_RETRY_MAX_DELAY_MS,
	);
	let errorsThisStep = 0;
	let streamRetryAttempts = 0;
	let streamRetryWaitMs = 0;
	return {
		startStep() {
			errorsThisStep = 0;
		},
		onError(error) {
			errorsThisStep += 1;
			if (errorsThisStep > maxRetries || !isFollowedByStreamRetry(error)) {
				return undefined;
			}
			const delayMs = Math.min(
				baseDelayMs * 2 ** (errorsThisStep - 1),
				maxDelayMs,
			);
			streamRetryAttempts += 1;
			streamRetryWaitMs += delayMs;
			return { attempt: errorsThisStep, delayMs };
		},
		summary() {
			return { streamRetryAttempts, streamRetryWaitMs };
		},
	};
}

function isFollowedByStreamRetry(error: unknown): boolean {
	if (
		RetryError.isInstance(error) ||
		ToolChoiceViolationError.isInstance(error) ||
		isTransientNetworkError(error)
	) {
		return false;
	}
	return classifyProviderError(error) === "unknown";
}
