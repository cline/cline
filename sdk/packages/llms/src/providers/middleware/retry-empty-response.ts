// LanguageModelV4 middleware that retries an Ollama stream when the model
// returns an *empty* turn — no text, no reasoning, and no tool call.
//
// Background: local backends (Ollama especially) intermittently return a
// response that finishes normally but carries no content at all. In Cline's
// runtime an empty assistant turn is a hard failure ("Model returned empty
// response"), so a single flaky generation kills the whole task. The
// `ai-sdk-ollama` provider ships a "reliability" layer for this, but it lives
// in `doGenerate` and *owns the tool loop* (it executes tools itself and
// force-synthesizes a final text answer). That is fundamentally incompatible
// with Cline, which streams via `doStream` and runs its own tool loop — a
// tool-call-only turn is the correct, desired outcome here, not something to
// "complete". So instead of adopting that layer, this middleware adds the one
// piece that is safe for a streaming, self-looping host: retry only when a
// turn produced genuinely nothing.
//
// Safety properties:
//   * A tool-call-only turn counts as content, so it is never retried.
//   * Non-empty turns stream through live, chunk by chunk, with zero added
//     latency — the retry logic only ever engages after an empty turn ends,
//     at which point nothing has been surfaced to the consumer yet, so
//     swapping in a fresh attempt is seamless.
//   * Turns that finish with an error or hit the token limit are passed
//     through unchanged (retrying wouldn't help and could mask the cause).

import type {
	LanguageModelV4Middleware,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

/** Minimal logger surface (a subset of `BasicLogger`). */
interface RetryLogger {
	log?(message: string, meta?: Record<string, unknown>): void;
}

export interface RetryEmptyResponseOptions {
	/** Total attempts including the first (so `3` means up to 2 retries). */
	maxAttempts?: number;
	/** Delay before each retry, in milliseconds. */
	retryDelayMs?: number;
	logger?: RetryLogger;
}

/** Default total attempts (first try + 2 retries). */
export const DEFAULT_EMPTY_RESPONSE_MAX_ATTEMPTS = 3;
/** Default delay before a retry. */
export const DEFAULT_EMPTY_RESPONSE_RETRY_DELAY_MS = 250;

/**
 * Finish reasons that indicate a "normal" completion where an empty body is a
 * transient provider glitch worth retrying. `error` (upstream failure),
 * `length` (token limit — retrying re-hits it), and `content-filter` are left
 * alone.
 */
const RETRYABLE_FINISH_REASONS = new Set(["stop", "other", "unknown"]);

/**
 * A stream part counts as real model output. Notably a `tool-call` (or its
 * streaming `tool-input-*` parts) counts, so a tool-call-only turn — the
 * normal shape when the model wants to act — is never treated as empty.
 * Structural markers (`text-start`/`-end`, `stream-start`, `response-metadata`,
 * `finish`, `raw`) do not count.
 */
function isContentPart(part: LanguageModelV4StreamPart): boolean {
	switch (part.type) {
		case "text-delta":
		case "reasoning-delta":
			return part.delta.length > 0;
		case "tool-call":
		case "tool-input-start":
		case "tool-input-delta":
		case "tool-input-end":
		case "tool-result":
		case "tool-approval-request":
		case "file":
		case "source":
			return true;
		default:
			return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a middleware that retries empty Ollama responses. Apply it as the
 * outermost middleware (first in the `wrapLanguageModel` array) so each retry
 * re-runs the full request.
 */
export function createRetryEmptyResponseMiddleware(
	options: RetryEmptyResponseOptions = {},
): LanguageModelV4Middleware {
	const maxAttempts = Math.max(
		1,
		options.maxAttempts ?? DEFAULT_EMPTY_RESPONSE_MAX_ATTEMPTS,
	);
	const retryDelayMs = Math.max(
		0,
		options.retryDelayMs ?? DEFAULT_EMPTY_RESPONSE_RETRY_DELAY_MS,
	);
	const logger = options.logger;

	return {
		specificationVersion: "v4",
		wrapStream: async ({ doStream, model }) => {
			// Kick off the first attempt eagerly, matching normal doStream timing.
			const firstResult = await doStream();

			const stream = new ReadableStream<LanguageModelV4StreamPart>({
				async start(controller) {
					let result: LanguageModelV4StreamResult = firstResult;
					let streamStartForwarded = false;

					for (let attempt = 1; ; attempt++) {
						const reader = result.stream.getReader();
						let hadContent = false;
						let sawError = false;
						let pendingFinish: Extract<
							LanguageModelV4StreamPart,
							{ type: "finish" }
						> | null = null;

						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) {
									break;
								}
								if (value.type === "stream-start") {
									// Forward warnings exactly once across all attempts.
									if (!streamStartForwarded) {
										controller.enqueue(value);
										streamStartForwarded = true;
									}
									continue;
								}
								if (value.type === "finish") {
									pendingFinish = value;
									continue;
								}
								if (value.type === "error") {
									sawError = true;
								} else if (isContentPart(value)) {
									hadContent = true;
								}
								controller.enqueue(value);
							}
						} catch (error) {
							controller.error(error);
							return;
						} finally {
							reader.releaseLock();
						}

						const finishReason =
							pendingFinish?.finishReason.unified ?? "unknown";
						const canRetry =
							!hadContent &&
							!sawError &&
							attempt < maxAttempts &&
							RETRYABLE_FINISH_REASONS.has(finishReason);

						if (!canRetry) {
							if (pendingFinish) {
								controller.enqueue(pendingFinish);
							}
							controller.close();
							return;
						}

						logger?.log?.("Ollama returned an empty response; retrying", {
							severity: "warn",
							modelId: model.modelId,
							attempt,
							maxAttempts,
							finishReason,
						});

						if (retryDelayMs > 0) {
							await sleep(retryDelayMs);
						}
						try {
							result = await doStream();
						} catch (error) {
							controller.error(error);
							return;
						}
					}
				},
			});

			return { ...firstResult, stream };
		},
	};
}
