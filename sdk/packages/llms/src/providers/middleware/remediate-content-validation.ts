// LanguageModelV4 middleware that recovers a turn when a provider rejects the
// request's own content shape — e.g. z.ai's Anthropic-compatible gateway
// answering "messages.content.type is invalid, allowed values: ['text']" once
// the conversation history carries image/file media parts or reasoning blocks
// the endpoint cannot accept.
//
// A rejection like that is deterministic (see `isRequestValidationRejection`),
// so resending the identical prompt can never succeed — the host's auto-retry
// policy correctly treats it as permanent. But in the common case the
// offending content is *incidental*: a screenshot attached to a user message,
// a browser capture inside a tool result, reasoning blocks replayed from an
// earlier turn. The conversation itself is perfectly usable without it, so
// instead of failing the turn we degrade gracefully:
//
//   1. Catch a definitive request-validation rejection at stream *initiation*
//      (before any content flowed, so a discarded attempt is invisible to the
//      consumer and nothing is double-emitted).
//   2. Strip the content classes an endpoint can reject when it demands
//      text-only messages: file/media parts and reasoning blocks become short
//      text placeholders; media nested inside tool-result outputs is
//      flattened the same way. Tool calls and tool results are kept — they
//      are essential to the agent loop, and if *those* are what the endpoint
//      rejects, no prompt rewrite can save the conversation anyway.
//   3. Re-send exactly once with the sanitized prompt. A second rejection
//      surfaces to the host unchanged, where the retry classifier settles it
//      as a permanent failure with the original error text.
//
// Apply as the *outermost* middleware (it must see the vendor's initiation
// rejection raw, and its retry must re-run the full inner pipeline — vendor
// middlewares like `splitToolImagesMiddleware` included — which is why the
// retry calls `model.doStream` with the sanitized params rather than
// replaying the original `doStream` closure).
//
// Notably out of scope (by design):
//   * User aborts are never remediated or retried.
//   * Mid-stream validation errors pass through untouched — once output has
//     flowed, replaying would duplicate it.
//   * No unbounded loop: one sanitization, one retry.

import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Message,
	LanguageModelV4Middleware,
	LanguageModelV4TextPart,
	LanguageModelV4ToolResultPart,
} from "@ai-sdk/provider";

import { isRequestValidationRejection } from "../error-classification";

/** Minimal logger surface (a subset of `BasicLogger`). */
interface RemediationLogger {
	log?(message: string, meta?: Record<string, unknown>): void;
}

/** Placeholder that replaces stripped content so the model knows it was there. */
export const CONTENT_REMOVED_PLACEHOLDER =
	"[content removed: this endpoint rejected non-text message content]";

function textPlaceholder(): LanguageModelV4TextPart {
	return { type: "text", text: CONTENT_REMOVED_PLACEHOLDER };
}

type ContentRecord = (kind: string) => void;

/**
 * Sanitize a tool-result output's nested content parts: text survives, media
 * (and anything else non-text) becomes a placeholder. Non-`content` outputs
 * (plain text, json, error-text, …) are already wire-safe and pass through.
 */
function sanitizeToolResultOutput(
	output: LanguageModelV4ToolResultPart["output"],
	record: ContentRecord,
): LanguageModelV4ToolResultPart["output"] {
	if (
		typeof output !== "object" ||
		output === null ||
		output.type !== "content" ||
		!Array.isArray(output.value)
	) {
		return output;
	}
	let mutated = false;
	const value = output.value.map((part) => {
		if (part.type === "text") {
			return part;
		}
		mutated = true;
		record(`tool-result ${part.type}`);
		return textPlaceholder();
	});
	if (!mutated) {
		return output;
	}
	return { ...output, value };
}

/**
 * Rewrite a `LanguageModelV4Prompt` so every message carries only content an
 * endpoint demanding text-only messages can accept:
 *
 *   * `file` parts (images / documents in user or assistant messages) →
 *     text placeholder
 *   * `reasoning` / `reasoning-file` / `custom` parts → dropped (replaced by
 *     a placeholder only when the message would otherwise be empty, since
 *     wire formats reject empty content arrays)
 *   * media nested in tool-result `content` outputs → text placeholder
 *   * `text`, `tool-call`, and `tool-result` parts survive untouched
 *
 * Returns `null` when nothing changed (nothing to remediate); otherwise the
 * new prompt and the record of removed content kinds.
 */
export function sanitizePromptContentTypes(
	prompt: LanguageModelV4Message[],
): { prompt: LanguageModelV4Message[]; removed: string[] } | null {
	const removed = new Set<string>();
	const record: ContentRecord = (kind) => {
		removed.add(kind);
	};
	let mutated = false;

	const newPrompt = prompt.map((message) => {
		if (typeof message.content === "string") {
			// system message — already text
			return message;
		}
		let messageMutated = false;
		const content: unknown[] = [];
		for (const part of message.content as Array<{ type: string }>) {
			switch (part.type) {
				case "file": {
					content.push(textPlaceholder());
					messageMutated = true;
					record("file");
					break;
				}
				case "reasoning":
				case "reasoning-file":
				case "custom": {
					messageMutated = true;
					record(part.type);
					// Dropped outright — see the file-level doc comment.
					break;
				}
				case "tool-result": {
					const toolResultPart =
						part as unknown as LanguageModelV4ToolResultPart;
					const output = sanitizeToolResultOutput(
						toolResultPart.output,
						record,
					);
					if (output === toolResultPart.output) {
						content.push(part);
					} else {
						messageMutated = true;
						content.push({ ...toolResultPart, output });
					}
					break;
				}
				default: {
					content.push(part);
					break;
				}
			}
		}
		if (content.length === 0) {
			// Every part was dropped; wire formats reject empty content arrays,
			// so keep the message alive with a placeholder.
			content.push(textPlaceholder());
		}
		if (!messageMutated) {
			return message;
		}
		mutated = true;
		return { ...message, content } as LanguageModelV4Message;
	});

	if (!mutated) {
		return null;
	}
	return { prompt: newPrompt, removed: [...removed] };
}

/**
 * Create the request-validation remediation middleware. Apply it as the
 * outermost wrap (`withContentValidationRemediation` in `ai-sdk.ts`) so its
 * single sanitized retry re-runs the vendor's full request pipeline.
 */
export function createContentValidationRemediationMiddleware(
	options: { logger?: RemediationLogger } = {},
): LanguageModelV4Middleware {
	const logger = options.logger;
	return {
		specificationVersion: "v4",
		wrapStream: async ({ doStream, params, model }) => {
			try {
				return await doStream();
			} catch (error) {
				if (
					params.abortSignal?.aborted ||
					!isRequestValidationRejection(error)
				) {
					throw error;
				}
				const sanitized = sanitizePromptContentTypes(params.prompt);
				if (sanitized === null) {
					// Nothing strippable — the rejection must be about content we
					// cannot rewrite (tools, fields); surface it unchanged.
					throw error;
				}
				logger?.log?.(
					"Request rejected for its content shape; retrying once with non-text content stripped",
					{
						severity: "warn",
						provider: model.provider,
						modelId: model.modelId,
						removed: sanitized.removed,
						error: error instanceof Error ? error.message : String(error),
					},
				);
				// Exactly one remediated retry; a second rejection propagates to
				// the host, whose retry classifier settles it as permanent.
				return model.doStream({
					...(params as LanguageModelV4CallOptions),
					prompt: sanitized.prompt,
				});
			}
		},
	};
}
