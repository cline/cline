// Single, exhaustive classification of every `LanguageModelV4StreamPart`.
//
// Two consumers previously held independent, incomplete interpretations of
// this union: the empty-response retry middleware decided "did the model
// produce anything?" and `emitAiSdkEvents()` in `ai-sdk.ts` decided "what do
// we convert into agent events?". A part counted by one but not the other
// produced exactly the failure the retry exists to prevent — e.g. a
// file-only turn was "content" to the middleware (never retried) but was
// dropped by the adapter, so the assistant message came out empty and the
// task still died with "Model returned empty response".
//
// This module is the one place that assigns each part a class; the retry
// middleware derives retry eligibility from it, and the adapter's supported
// set must stay in sync with `converted-content` (asserted by tests). The
// switch is exhaustive with a `never` check, so an AI SDK upgrade that adds
// a new part type fails compilation here instead of silently landing in the
// wrong bucket.

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

export type ModelStreamPartClass =
	/**
	 * Output that `emitAiSdkEvents()` converts into `AgentModelEvent`s and
	 * that therefore reaches the assistant message. A turn containing any of
	 * these is not empty.
	 */
	| "converted-content"
	/**
	 * Real model output that Cline does not (yet) convert into agent events.
	 * The model responded, so retrying would waste billable requests and
	 * likely reproduce the same output — never retried. If a turn contains
	 * ONLY unsupported output the assistant message can still come out
	 * empty; that is an explicit contract gap of this bucket, preferred over
	 * silently re-billing a turn the model did answer.
	 */
	| "unsupported-output"
	/** Markers and metadata that do not constitute model output. */
	| "structural"
	/** `stream-start` — carries warnings; one per attempt. */
	| "stream-start"
	/** Terminal accounting part — carries usage and the finish reason. */
	| "finish"
	/** An upstream error surfaced as a stream part. */
	| "error";

export function classifyModelStreamPart(
	part: LanguageModelV4StreamPart,
): ModelStreamPartClass {
	switch (part.type) {
		case "text-delta":
		case "reasoning-delta":
			return part.delta.length > 0 ? "converted-content" : "structural";
		// Tool activity: the adapter converts tool calls (and their streaming
		// input parts assemble into them). A tool-call-only turn is the
		// normal shape when the model wants to act — never empty.
		case "tool-call":
		case "tool-input-start":
		case "tool-input-delta":
		case "tool-input-end":
			return "converted-content";
		// Generated files are converted into `file` agent events (see
		// `emitAiSdkEvents`) and land in the assistant message as image or
		// file parts.
		case "file":
			return "converted-content";
		// Provider-executed tool results arrive after a converted tool-call;
		// the result itself is not translated into an agent event.
		case "tool-result":
		// Provider-side approval requests for provider-executed tools.
		case "tool-approval-request":
		// Opaque reasoning blobs (e.g. encrypted/redacted thinking files).
		case "reasoning-file":
		// Provider-specific content in `{provider}.{type}` envelopes.
		case "custom":
		// URL citations attached to generated text.
		case "source":
			return "unsupported-output";
		case "text-start":
		case "text-end":
		case "reasoning-start":
		case "reasoning-end":
		case "response-metadata":
		case "raw":
			return "structural";
		case "stream-start":
			return "stream-start";
		case "finish":
			return "finish";
		case "error":
			return "error";
		default: {
			// Exhaustiveness guard: a new AI SDK part type must be classified
			// deliberately, not fall through.
			const unhandled: never = part;
			throw new Error(
				`Unclassified model stream part: ${JSON.stringify(unhandled)}`,
			);
		}
	}
}

/**
 * Whether a completed attempt that contained only parts for which this
 * returns `false` (plus `stream-start`/`finish`) counts as a genuinely empty
 * turn. Both converted and unsupported output mean "the model responded".
 */
export function isModelOutputPart(part: LanguageModelV4StreamPart): boolean {
	const kind = classifyModelStreamPart(part);
	return kind === "converted-content" || kind === "unsupported-output";
}
