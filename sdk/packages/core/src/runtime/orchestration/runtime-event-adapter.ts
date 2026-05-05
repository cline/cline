/**
 * Adapter from the new `AgentRuntimeEvent` union (13 variants, defined
 * in `@clinebot/shared/src/agent.ts`) to the legacy `AgentEvent` union
 * (9 top-level types, defined in
 * `@clinebot/shared/src/agents/types.ts`) consumed by today's
 * `Agent.subscribeEvents` callback.
 *
 * @see PLAN.md §3.1  — new file introduced alongside the core runtime port.
 * @see PLAN.md §3.3.2 — variant-by-variant OLD → NEW mapping.
 * @see PLAN.md §3.2.4 — called from `Agent.subscribeEvents` inside the
 *                       legacy-agent facade.
 *
 * --- IMPLEMENTATION NOTE — PLAN §3.3.2 text/reasoning-delta rows ----------
 *
 * PLAN.md §3.3.2 describes `assistant-text-delta` as "first delta →
 * content_start, subsequent → content_update". The **actual** legacy
 * shape forbids this: `AgentContentUpdateEvent.contentType` is
 * hard-typed as `"tool"` in
 * `packages/shared/src/agents/types.ts:87`, and the legacy
 * turn-processor
 * (`packages/agents/src/runtime/turn-processor.ts:82-87,113-118`)
 * emits a `content_start` event for **every** text delta and for
 * **every** reasoning delta — not just the first. This adapter
 * preserves that observable behavior (what every legacy consumer
 * relies on today) over the description in §3.3.2.
 *
 *   text deltas      → content_start { contentType:"text", text,
 *                        accumulated } (per delta)
 *   reasoning deltas → content_start { contentType:"reasoning",
 *                        reasoning, redacted } (per delta)
 *   assistant-message → one content_end { contentType:"text", text }
 *                        if any text parts; one
 *                        content_end { contentType:"reasoning", reasoning }
 *                        if any reasoning parts
 *                        (turn-processor.ts:157-170).
 *
 * --- STATEFUL BOOK-KEEPING ------------------------------------------------
 *
 *  1. Rolling usage totals. `usage-updated` carries the already-
 *     accumulated snapshot (agent-runtime.ts:668-683). Legacy
 *     `AgentUsageEvent` wants both per-turn delta and accumulated
 *     totals; the adapter subtracts the previous accumulated value
 *     from the incoming one to produce the delta.
 *  2. Tool timing. `tool-finished` does not carry `durationMs`. The
 *     adapter records `Date.now()` on `tool-started` (keyed by
 *     `toolCallId`) and computes `durationMs` at `tool-finished`.
 *     Matches `tool-orchestrator.ts:112-131`.
 *
 * Both are scoped to a single adapter instance and cleared by
 * `reset()`.
 */

import type {
	AgentEvent,
	AgentFinishReason,
	AgentMessage,
	AgentReasoningPart,
	AgentRuntimeEvent,
	AgentTextPart,
	AgentToolResultPart,
	AgentUsage,
	LegacyAgentUsage,
} from "@clinebot/shared";

// =============================================================================
// Helpers
// =============================================================================

function extractTextPart(message: AgentMessage): string | undefined {
	const parts = message.content.filter(
		(part): part is AgentTextPart => part.type === "text",
	);
	if (parts.length === 0) {
		return undefined;
	}
	return parts.map((part) => part.text).join("");
}

function extractReasoningPart(
	message: AgentMessage,
): { reasoning: string; redacted: boolean } | undefined {
	const parts = message.content.filter(
		(part): part is AgentReasoningPart => part.type === "reasoning",
	);
	if (parts.length === 0) {
		return undefined;
	}
	return {
		reasoning: parts.map((part) => part.text).join(""),
		redacted: parts.some((part) => part.redacted === true),
	};
}

function extractToolResultPart(
	message: AgentMessage,
): AgentToolResultPart | undefined {
	return message.content.find(
		(part): part is AgentToolResultPart => part.type === "tool-result",
	);
}

function textFromMessage(message: AgentMessage | undefined): string {
	if (!message) {
		return "";
	}
	return extractTextPart(message) ?? "";
}

function statusToLegacyFinishReason(
	status: "completed" | "aborted" | "failed",
): AgentFinishReason {
	switch (status) {
		case "completed":
			return "completed";
		case "aborted":
			return "aborted";
		case "failed":
			return "error";
	}
}

function deriveToolError(
	result: AgentToolResultPart | undefined,
): string | undefined {
	if (!result || result.isError !== true) {
		return undefined;
	}
	if (typeof result.output === "string") {
		return result.output;
	}
	if (result.output instanceof Error) {
		return result.output.message;
	}
	try {
		return JSON.stringify(result.output);
	} catch {
		return String(result.output);
	}
}

// =============================================================================
// Stateful adapter
// =============================================================================

/**
 * Per-subscriber adapter instance. Constructed once per
 * `Agent.subscribeEvents` registration (or per `SessionRuntime`),
 * used for the lifetime of that subscription, and `reset()` at the
 * start of every new run.
 *
 * `translate(event)` returns zero, one, or two `AgentEvent`s. An
 * array is needed because a single `assistant-message` may yield both
 * a text `content_end` and a reasoning `content_end`. Empty array
 * means the event is intentionally suppressed (§3.3.2 rows
 * `run-started`, `message-added`).
 */
export class RuntimeEventAdapter {
	private lastUsage: AgentUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalCost: 0,
	};

	private toolStartedAt = new Map<string, number>();

	translate(event: AgentRuntimeEvent): AgentEvent[] {
		switch (event.type) {
			case "run-started":
				return [];
			case "message-added":
				return [];
			case "turn-started":
				return [{ type: "iteration_start", iteration: event.iteration }];
			case "turn-finished":
				return [
					{
						type: "iteration_end",
						iteration: event.iteration,
						hadToolCalls: event.toolCallCount > 0,
						toolCallCount: event.toolCallCount,
					},
				];
			case "assistant-text-delta":
				return [
					{
						type: "content_start",
						contentType: "text",
						text: event.text,
						accumulated: event.accumulatedText,
					},
				];
			case "assistant-reasoning-delta":
				return [
					{
						type: "content_start",
						contentType: "reasoning",
						reasoning: event.text,
						redacted: event.redacted === true,
					},
				];
			case "assistant-message":
				return this.translateAssistantMessage(event.message);
			case "tool-started":
				return this.translateToolStarted(event);
			case "tool-updated":
				return [
					{
						type: "content_update",
						contentType: "tool",
						toolName: event.toolCall.toolName,
						toolCallId: event.toolCall.toolCallId,
						update: event.update,
					},
				];
			case "tool-finished":
				return this.translateToolFinished(event);
			case "usage-updated":
				return this.translateUsage(event.usage);
			case "status-notice":
				return [
					{
						type: "notice",
						noticeType: "status",
						displayRole: "status",
						message: event.message,
						reason:
							event.metadata?.reason === "auto_compaction"
								? "auto_compaction"
								: undefined,
						metadata: event.metadata,
					},
				];
			case "run-finished":
				return this.translateRunFinished(event.result);
			case "run-failed":
				return [
					{
						type: "error",
						error: event.error,
						recoverable: false,
						iteration: event.snapshot.iteration,
					},
				];
			default: {
				const _exhaustive: never = event;
				return _exhaustive;
			}
		}
	}

	reset(): void {
		this.lastUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		};
		this.toolStartedAt.clear();
	}

	// ------- per-variant translators ------------------------------------

	private translateAssistantMessage(message: AgentMessage): AgentEvent[] {
		const out: AgentEvent[] = [];
		const text = extractTextPart(message);
		if (text !== undefined) {
			out.push({ type: "content_end", contentType: "text", text });
		}
		const reasoning = extractReasoningPart(message);
		if (reasoning !== undefined) {
			out.push({
				type: "content_end",
				contentType: "reasoning",
				reasoning: reasoning.reasoning,
			});
		}
		return out;
	}

	private translateToolStarted(event: {
		toolCall: { toolCallId: string; toolName: string; input: unknown };
	}): AgentEvent[] {
		this.toolStartedAt.set(event.toolCall.toolCallId, Date.now());
		return [
			{
				type: "content_start",
				contentType: "tool",
				toolName: event.toolCall.toolName,
				toolCallId: event.toolCall.toolCallId,
				input: event.toolCall.input,
			},
		];
	}

	private translateToolFinished(event: {
		toolCall: { toolCallId: string; toolName: string };
		message: AgentMessage;
	}): AgentEvent[] {
		const startedAt = this.toolStartedAt.get(event.toolCall.toolCallId);
		const durationMs =
			startedAt === undefined ? undefined : Date.now() - startedAt;
		this.toolStartedAt.delete(event.toolCall.toolCallId);
		const result = extractToolResultPart(event.message);
		const output = result?.output;
		const error = deriveToolError(result);
		return [
			{
				type: "content_end",
				contentType: "tool",
				toolName: event.toolCall.toolName,
				toolCallId: event.toolCall.toolCallId,
				output,
				error,
				durationMs,
			},
		];
	}

	private translateUsage(next: AgentUsage): AgentEvent[] {
		const deltaInput = next.inputTokens - this.lastUsage.inputTokens;
		const deltaOutput = next.outputTokens - this.lastUsage.outputTokens;
		const deltaCacheRead =
			next.cacheReadTokens - this.lastUsage.cacheReadTokens;
		const deltaCacheWrite =
			next.cacheWriteTokens - this.lastUsage.cacheWriteTokens;
		const prevCost = this.lastUsage.totalCost ?? 0;
		const nextCost = next.totalCost ?? 0;
		const deltaCost = nextCost - prevCost;
		this.lastUsage = {
			inputTokens: next.inputTokens,
			outputTokens: next.outputTokens,
			cacheReadTokens: next.cacheReadTokens,
			cacheWriteTokens: next.cacheWriteTokens,
			totalCost: next.totalCost,
		};
		return [
			{
				type: "usage",
				inputTokens: Math.max(0, deltaInput),
				outputTokens: Math.max(0, deltaOutput),
				cacheReadTokens:
					deltaCacheRead === 0 ? undefined : Math.max(0, deltaCacheRead),
				cacheWriteTokens:
					deltaCacheWrite === 0 ? undefined : Math.max(0, deltaCacheWrite),
				cost: deltaCost === 0 ? undefined : deltaCost,
				totalInputTokens: next.inputTokens,
				totalOutputTokens: next.outputTokens,
				totalCacheReadTokens:
					next.cacheReadTokens === 0 ? undefined : next.cacheReadTokens,
				totalCacheWriteTokens:
					next.cacheWriteTokens === 0 ? undefined : next.cacheWriteTokens,
				totalCost: next.totalCost,
			},
		];
	}

	private translateRunFinished(result: {
		status: "completed" | "aborted" | "failed";
		outputText: string;
		iterations: number;
		usage: AgentUsage;
	}): AgentEvent[] {
		const usage: LegacyAgentUsage = {
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			cacheReadTokens:
				result.usage.cacheReadTokens === 0
					? undefined
					: result.usage.cacheReadTokens,
			cacheWriteTokens:
				result.usage.cacheWriteTokens === 0
					? undefined
					: result.usage.cacheWriteTokens,
			totalCost: result.usage.totalCost,
		};
		return [
			{
				type: "done",
				reason: statusToLegacyFinishReason(result.status),
				text: result.outputText,
				iterations: result.iterations,
				usage,
			},
		];
	}
}

// =============================================================================
// Stateless convenience export
// =============================================================================

/**
 * Stateless translator. Works correctly for every variant except
 * those that require bookkeeping:
 *
 *  - `usage-updated` — deltas cannot be computed without a prior
 *    snapshot; this function treats the prior snapshot as zero (so
 *    delta == accumulated). Adequate for a single event, incorrect
 *    across multiple.
 *  - `tool-finished` — `durationMs` is reported as `undefined`
 *    because the corresponding `tool-started` was never observed by
 *    this one-shot adapter.
 *
 * Production code must use `RuntimeEventAdapter` for multi-event
 * runs; this function exists for ad-hoc unit tests and one-shot
 * translations where bookkeeping does not matter.
 *
 * Returns `undefined` when the event maps to zero legacy events
 * (`run-started`, `message-added`, or an `assistant-message` that
 * carries no text/reasoning parts). When an event produces multiple
 * legacy events (e.g. `assistant-message` with both text and
 * reasoning parts), only the first is returned; callers needing the
 * full array must use `RuntimeEventAdapter.translate()`.
 */
export function toLegacyAgentEvent(
	event: AgentRuntimeEvent,
): AgentEvent | undefined {
	const adapter = new RuntimeEventAdapter();
	const translated = adapter.translate(event);
	return translated[0];
}

export { textFromMessage };
