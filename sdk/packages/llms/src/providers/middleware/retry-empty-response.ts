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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
	const logger = options.logger;

	return {
		specificationVersion: "v4",
		wrapStream: async ({ doStream, model }) => {
			// Kick off the first attempt eagerly, matching normal doStream timing.
			const firstResult = await doStream();

			const stream = new ReadableStream<LanguageModelV4StreamPart>({
				async start(controller) {
					let result: LanguageModelV4StreamResult = firstResult;
					const discardedUsage: LanguageModelV4Usage[] = [];

					for (let attempt = 1; ; attempt++) {
						const reader = result.stream.getReader();
						// Parts held back until this attempt proves non-empty.
						const buffered: LanguageModelV4StreamPart[] = [];
						let accepted = false;
						let pendingFinish: FinishPart | null = null;

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
							controller.error(error);
							return;
						} finally {
							reader.releaseLock();
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
