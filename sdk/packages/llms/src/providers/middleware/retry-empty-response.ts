// LanguageModelV4 middleware that retries a stream when the model returns an
// *empty* turn — no converted content and no unsupported output (see
// `stream-part-classification.ts` for the authoritative taxonomy).
//
// Background: providers intermittently return a response that finishes
// normally but carries no content at all. This was first observed on local
// backends (Ollama especially), but production telemetry shows hosted
// backends (openrouter, cline, generic OpenAI-compatible endpoints) do the
// same. In Cline's runtime an empty assistant turn is a hard failure ("Model
// returned empty response"), so a single flaky generation kills the whole
// task. The `ai-sdk-ollama` provider ships a "reliability" layer for this,
// but it lives in `doGenerate` and *owns the tool loop* (it executes tools
// itself and force-synthesizes a final text answer). That is fundamentally
// incompatible with Cline, which streams via `doStream` and runs its own tool
// loop — a tool-call-only turn is the correct, desired outcome here, not
// something to "complete". So instead of adopting that layer, this middleware
// adds the one piece that is safe for a streaming, self-looping host: retry
// only when a turn produced genuinely nothing.
//
// It is applied to every AI SDK vendor at the central composition point in
// `ai-sdk.ts` (see `withEmptyResponseRetry`); vendors can opt out or tune
// attempts via `ProviderFactoryResult.retryEmptyResponses`.
//
// Stream mechanics: each attempt is BUFFERED until it proves itself — the
// first output part (converted content, unsupported output, or an error)
// accepts the attempt, at which point the buffer is flushed and the rest of
// the attempt streams through live. Rejected (empty) attempts are discarded
// wholesale, so no structural parts, response metadata, or empty block
// markers from discarded requests ever leak into the logical stream — one
// retried request produces one clean stream. Because empty attempts still
// bill real tokens on hosted providers, their `finish.usage` is aggregated
// into the final finish part, so a turn that took three requests reports
// three requests' worth of usage.
//
// The same buffer-until-proven window also covers a second transient
// failure mode: the attempt's stream REJECTING with a network interruption
// before the model produced anything (see `isTransientNetworkError`).
// Production telemetry on the SDK arch shows these as the dominant
// network-class run killer — `terminated: SocketError: other side closed
// (UND_ERR_SOCKET)`, `terminated: BodyTimeoutError`, `terminated: read
// ECONNRESET`, `fetch failed: HeadersTimeoutError`. The AI SDK's own retry
// only guards request *initiation* (it re-runs `doStream()` when that call
// rejects with a retryable APICallError); once the stream has started, a
// body death escapes `postToApi`'s error wrapping and rejects the stream
// raw, killing the run — a failure the legacy extension's first-chunk retry
// loop absorbed silently. Retrying here is safe for the same reason the
// empty retry is: nothing has been emitted yet, so a discarded attempt is
// invisible to the consumer. A failure AFTER output has flowed still passes
// through unchanged (resuming mid-content would require deduplicating
// already-delivered text), and a user abort is never retried.
//
// Safety properties:
//   * A tool-call-only turn counts as content, so it is never retried.
//   * Unsupported-but-real output (custom parts, reasoning files, sources,
//     provider-executed tool results) is never retried either — the model
//     responded; re-billing the request would not help.
//   * Non-empty turns stream through live: buffering only lasts until the
//     first output part, which for a non-empty turn is the moment it starts
//     producing anything.
//   * Turns that finish with an error or hit the token limit are passed
//     through unchanged (retrying wouldn't help and could mask the cause).
//   * Provider-reported in-band `error` parts accept the attempt and pass
//     through — they are business errors, not transport failures.
//   * A successfully retried failure never reaches `streamText`, so no
//     `onError`/`captureSdkError`/`task.provider_api_error` fires for it;
//     an exhausted or non-retryable failure rejects the stream exactly as
//     an unwrapped one does today, leaving the reporting path unchanged.

import type {
	LanguageModelV4Middleware,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { classifyModelStreamPart } from "./stream-part-classification";

/** Minimal logger surface (a subset of `BasicLogger`). */
interface RetryLogger {
	log?(message: string, meta?: Record<string, unknown>): void;
}

export interface RetryEmptyResponseOptions {
	/** Total attempts including the first (so `3` means up to 2 retries). */
	maxAttempts?: number;
	/** Delay before each empty-response retry, in milliseconds. */
	retryDelayMs?: number;
	/**
	 * Delay before the first network-interruption retry, in milliseconds;
	 * doubles for each subsequent one (2s → 4s with the defaults, matching
	 * the legacy extension's backoff).
	 */
	networkRetryDelayMs?: number;
	logger?: RetryLogger;
}

/** Default total attempts (first try + 2 retries). */
export const DEFAULT_EMPTY_RESPONSE_MAX_ATTEMPTS = 3;
/** Default delay before a retry. */
export const DEFAULT_EMPTY_RESPONSE_RETRY_DELAY_MS = 250;
/** Default delay before the first network-interruption retry. */
export const DEFAULT_NETWORK_RETRY_DELAY_MS = 2_000;

const MAX_CAUSE_DEPTH = 8;

/**
 * Error codes of transient transport interruptions, from the runtimes this
 * package runs under: undici (Node fetch — the VS Code extension host),
 * plain Node/Bun sockets, and Bun's fetch (CLI, desktop sidecar).
 */
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
	"UND_ERR_SOCKET",
	"UND_ERR_BODY_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"ECONNRESET",
	"EPIPE",
	"ETIMEDOUT",
	"ConnectionClosed",
]);

/**
 * Node's fetch wraps every mid-body termination in `TypeError("terminated")`
 * (socket-level cause attached) and connection failures in
 * `TypeError("fetch failed")`; WebKit says "failed to fetch".
 */
const NETWORK_TYPE_ERROR_MESSAGES = new Set([
	"terminated",
	"fetch failed",
	"failed to fetch",
]);

/**
 * Whether an error (anywhere in its `cause` chain) identifies a transient
 * transport interruption — the connection died or timed out underneath a
 * request the provider never rejected. An abort anywhere in the chain
 * vetoes the match: cancelled requests surface the same socket vocabulary,
 * and a user cancel must never be retried. Everything else — HTTP business
 * errors, context-window errors, provider-reported payloads — does not
 * match.
 */
export function isTransientNetworkError(error: unknown): boolean {
	let aborted = false;
	let transient = false;
	let current: unknown = error;
	const seen = new Set<unknown>();
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH &&
		current != null &&
		typeof current === "object" &&
		!seen.has(current);
		depth++
	) {
		seen.add(current);
		const candidate = current as {
			name?: unknown;
			message?: unknown;
			code?: unknown;
			cause?: unknown;
		};
		if (
			candidate.name === "AbortError" ||
			candidate.name === "ResponseAborted"
		) {
			aborted = true;
		}
		if (
			(current instanceof TypeError &&
				typeof candidate.message === "string" &&
				NETWORK_TYPE_ERROR_MESSAGES.has(candidate.message.toLowerCase())) ||
			(typeof candidate.code === "string" &&
				TRANSIENT_NETWORK_ERROR_CODES.has(candidate.code))
		) {
			transient = true;
		}
		current = candidate.cause;
	}
	return transient && !aborted;
}

/**
 * Finish reasons that indicate a "normal" completion where an empty body is a
 * transient provider glitch worth retrying. `error` (upstream failure),
 * `length` (token limit — retrying re-hits it), and `content-filter` are left
 * alone.
 */
const RETRYABLE_FINISH_REASONS = new Set(["stop", "other", "unknown"]);

type FinishPart = Extract<LanguageModelV4StreamPart, { type: "finish" }>;

function addCounts(
	a: number | undefined,
	b: number | undefined,
): number | undefined {
	if (a === undefined && b === undefined) {
		return undefined;
	}
	return (a ?? 0) + (b ?? 0);
}

/** Sum two standardized v4 usage records field by field. */
export function addUsage(
	a: LanguageModelV4Usage,
	b: LanguageModelV4Usage,
): LanguageModelV4Usage {
	return {
		inputTokens: {
			total: addCounts(a.inputTokens?.total, b.inputTokens?.total),
			noCache: addCounts(a.inputTokens?.noCache, b.inputTokens?.noCache),
			cacheRead: addCounts(a.inputTokens?.cacheRead, b.inputTokens?.cacheRead),
			cacheWrite: addCounts(
				a.inputTokens?.cacheWrite,
				b.inputTokens?.cacheWrite,
			),
		},
		outputTokens: {
			total: addCounts(a.outputTokens?.total, b.outputTokens?.total),
			text: addCounts(a.outputTokens?.text, b.outputTokens?.text),
			reasoning: addCounts(
				a.outputTokens?.reasoning,
				b.outputTokens?.reasoning,
			),
		},
		// `raw` is provider-specific and cannot be summed generically; the
		// emitted finish keeps the final attempt's raw payload.
		...(b.raw !== undefined ? { raw: b.raw } : {}),
	};
}

/**
 * Fold the usage of discarded attempts into the finish part that is actually
 * emitted, so hosted-provider billing reflects every request the turn made
 * (including cache and reasoning detail), not just the accepted one.
 */
function withAggregatedUsage(
	finish: FinishPart,
	discardedUsage: readonly LanguageModelV4Usage[],
): FinishPart {
	if (discardedUsage.length === 0) {
		return finish;
	}
	let usage = finish.usage;
	for (const discarded of discardedUsage) {
		usage = addUsage(discarded, usage);
	}
	return { ...finish, usage };
}

/** Sleep that resolves early (without throwing) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (ms <= 0 || signal?.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Create a middleware that retries empty model responses. Apply it as the
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
	const networkRetryDelayMs = Math.max(
		0,
		options.networkRetryDelayMs ?? DEFAULT_NETWORK_RETRY_DELAY_MS,
	);
	const logger = options.logger;

	return {
		specificationVersion: "v4",
		wrapStream: async ({ doStream, params, model }) => {
			const abortSignal = params.abortSignal;
			// Kick off the first attempt eagerly, matching normal doStream timing.
			const firstResult = await doStream();

			// Downstream cancellation must reach the provider's HTTP body. The
			// pump below lives in start(), so without an explicit cancel()
			// handler a consumer that stops reading would leave the pump
			// draining the response to completion — for a generation request
			// with no live AbortSignal that means the provider keeps producing
			// tokens nobody reads (and a local server keeps a slot busy).
			// `cancelController` also cuts the backoff sleeps short so a
			// cancelled pump exits promptly instead of re-dialing later.
			let activeReader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | null =
				null;
			const cancelController = new AbortController();
			const cancelled = () => cancelController.signal.aborted;
			const backoffSignal = abortSignal
				? AbortSignal.any([abortSignal, cancelController.signal])
				: cancelController.signal;

			const stream = new ReadableStream<LanguageModelV4StreamPart>({
				cancel(reason) {
					cancelController.abort(reason);
					return activeReader?.cancel(reason);
				},
				async start(controller) {
					let result: LanguageModelV4StreamResult = firstResult;
					const discardedUsage: LanguageModelV4Usage[] = [];
					// Counted separately from the shared attempt number so the
					// first network retry always waits `networkRetryDelayMs`,
					// regardless of any empty-response retries that came first.
					let networkRetries = 0;

					for (let attempt = 1; ; attempt++) {
						const reader = result.stream.getReader();
						activeReader = reader;
						// Parts held back until this attempt proves non-empty.
						const buffered: LanguageModelV4StreamPart[] = [];
						let accepted = false;
						let pendingFinish: FinishPart | null = null;
						let streamFailure: unknown;
						let streamFailed = false;

						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) {
									break;
								}
								if (value.type === "finish") {
									// Held back so the emitted finish can carry
									// aggregated usage; it is always last anyway.
									pendingFinish = value;
									continue;
								}
								if (!accepted) {
									const kind = classifyModelStreamPart(value);
									if (
										kind === "converted-content" ||
										kind === "unsupported-output" ||
										kind === "error"
									) {
										// The model produced output (or a real
										// error): accept this attempt, flush what
										// was buffered, and go live.
										accepted = true;
										for (const part of buffered) {
											controller.enqueue(part);
										}
										buffered.length = 0;
									}
								}
								if (accepted) {
									controller.enqueue(value);
								} else {
									buffered.push(value);
								}
							}
						} catch (error) {
							streamFailed = true;
							streamFailure = error;
						} finally {
							activeReader = null;
							reader.releaseLock();
						}

						if (cancelled()) {
							// The consumer cancelled: the inner reader is already
							// cancelled (or this attempt's read loop ended racing
							// the cancel). The controller is closed, so nothing
							// can be enqueued — and nothing should be retried.
							return;
						}

						if (streamFailed) {
							const canRetryFailure =
								// Only a pre-content death is retried; once
								// output has flowed, resuming would replay
								// text the consumer already saw.
								!accepted &&
								attempt < maxAttempts &&
								abortSignal?.aborted !== true &&
								isTransientNetworkError(streamFailure);
							if (!canRetryFailure) {
								controller.error(streamFailure);
								return;
							}
							if (pendingFinish) {
								discardedUsage.push(pendingFinish.usage);
							}
							const delayMs = networkRetryDelayMs * 2 ** networkRetries;
							networkRetries++;
							logger?.log?.(
								"Transient network interruption before any model output; retrying",
								{
									severity: "warn",
									provider: model.provider,
									modelId: model.modelId,
									attempt,
									maxAttempts,
									retryDelayMs: delayMs,
									error:
										streamFailure instanceof Error
											? streamFailure.message
											: String(streamFailure),
								},
							);
							await sleep(delayMs, backoffSignal);
							if (cancelled()) {
								// The consumer cancelled during backoff: the
								// controller is closed, so just stop.
								return;
							}
							if (abortSignal?.aborted) {
								// The user cancelled during backoff: surface
								// the abort instead of re-dialing.
								controller.error(abortSignal.reason ?? streamFailure);
								return;
							}
							try {
								result = await doStream();
							} catch (error) {
								controller.error(error);
								return;
							}
							continue;
						}

						if (accepted) {
							if (pendingFinish) {
								controller.enqueue(
									withAggregatedUsage(pendingFinish, discardedUsage),
								);
							}
							controller.close();
							return;
						}

						const finishReason =
							pendingFinish?.finishReason.unified ?? "unknown";
						const canRetry =
							attempt < maxAttempts &&
							RETRYABLE_FINISH_REASONS.has(finishReason);

						if (!canRetry) {
							// Out of retries (or a non-retryable finish): surface
							// the final attempt as-is — its structural parts plus a
							// finish carrying every attempt's usage — so the
							// downstream failure is honest about what happened.
							for (const part of buffered) {
								controller.enqueue(part);
							}
							if (pendingFinish) {
								controller.enqueue(
									withAggregatedUsage(pendingFinish, discardedUsage),
								);
							}
							controller.close();
							return;
						}

						if (pendingFinish) {
							discardedUsage.push(pendingFinish.usage);
						}

						logger?.log?.("Model returned an empty response; retrying", {
							severity: "warn",
							provider: model.provider,
							modelId: model.modelId,
							attempt,
							maxAttempts,
							finishReason,
						});

						if (retryDelayMs > 0) {
							await sleep(retryDelayMs, cancelController.signal);
						}
						if (cancelled()) {
							return;
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
