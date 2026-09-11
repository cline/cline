/**
 * v1 AgentEvent stream grammar — transition tables, validator, wart registry.
 *
 * Phase 0 of the agent event stream v2 design
 * (`@cline/core/docs/agent-event-stream-design.md`). Encodes the
 * de-facto v1 grammar produced by `RuntimeEventAdapter`: violations are
 * producer bugs; warts are known deviations from the v2 target grammar,
 * counted so they are explicit instead of folklore. The v2 assembler and
 * trace generator will derive from these same tables. Structural warts
 * a trace cannot reveal (no blockId on text, content_end(tool) carrying
 * no input) live in the design doc, not here.
 */
import type { AgentEvent } from "./types";

// =============================================================================
// Violations — hard producer bugs
// =============================================================================

/** Producer emitted an event after the stream's terminal event. */
export const AFTER_TERMINAL = "after-terminal";
/** A second terminal event (done or non-recoverable error) in one stream. */
export const DOUBLE_TERMINAL = "double-terminal";
/** iteration_start while another iteration is open. */
export const ITERATION_OVERLAP = "iteration-overlap";
/** iteration_end with no open iteration. */
export const ITERATION_END_WITHOUT_START = "iteration-end-without-start";
/** iteration_start with a number not greater than the last ended iteration. */
export const ITERATION_REGRESSION = "iteration-regression";
/** Any content event emitted with no open iteration. */
export const CONTENT_OUTSIDE_ITERATION = "content-outside-iteration";
/** content_start(tool) for a toolCallId that is already open. */
export const TOOL_OPEN_WHILE_OPEN = "tool-open-while-open";
/** content_update(tool) for an unknown toolCallId. */
export const TOOL_UPDATE_WITHOUT_OPEN = "tool-update-without-open";
/** content_end(tool) for an unknown toolCallId. */
export const TOOL_END_WITHOUT_OPEN = "tool-end-without-open";
/** A tool block is still open when its iteration ends. */
export const TOOL_OPEN_AT_ITERATION_END = "tool-open-at-iteration-end";
/** A tool event arrived under a different iteration than the one it opened in. */
export const TOOL_WRONG_ITERATION = "tool-wrong-iteration";

export type StreamViolationCode =
	| typeof AFTER_TERMINAL
	| typeof DOUBLE_TERMINAL
	| typeof ITERATION_OVERLAP
	| typeof ITERATION_END_WITHOUT_START
	| typeof ITERATION_REGRESSION
	| typeof CONTENT_OUTSIDE_ITERATION
	| typeof TOOL_OPEN_WHILE_OPEN
	| typeof TOOL_UPDATE_WITHOUT_OPEN
	| typeof TOOL_END_WITHOUT_OPEN
	| typeof TOOL_OPEN_AT_ITERATION_END
	| typeof TOOL_WRONG_ITERATION;

export interface StreamViolation {
	code: StreamViolationCode;
	/** Index of the offending event in the input trace. */
	index: number;
	/** Discriminant of the offending event. */
	eventType: AgentEvent["type"];
	/** Extra identifying detail (e.g. the toolCallId involved). */
	detail?: string;
}

// =============================================================================
// Warts — known, accepted v1 deviations from the v2 grammar
// =============================================================================

/**
 * W1 — "content_start" is a delta for text/reasoning: the adapter maps
 * every assistant-text-delta / assistant-reasoning-delta to
 * content_start, so "start" repeats and there is no content_update for
 * streamed text. v2 renames these to deltas on an opened block.
 */
export const WART_START_AS_DELTA = "start-as-delta";
/**
 * W2 — content_end(text/reasoning) with zero prior content_start in its
 * iteration: the "final text with no streamed deltas" case that the
 * dedup folklore in consumers (sidecar/context.ts, streamer.go)
 * exists to handle. v2's close frame is authoritative and unambiguous.
 */
export const WART_FINAL_WITHOUT_DELTAS = "final-without-deltas";
/**
 * W3 — scopes left open at the terminal: v1 has no force-close, so an
 * abort or failure mid-iteration leaves the iteration and any in-flight
 * tool blocks dangling. v2's turn close force-closes children first.
 */
export const WART_DANGLING_AT_TERMINAL = "dangling-at-terminal";
/**
 * W4 — terminal-adjacent ambiguity: an in-run recoverable error reuses
 * the terminal "error" discriminant, or done(reason:"error") arrives
 * with no error event. v2 has one spelling of turn end.
 */
export const WART_TERMINAL_AMBIGUITY = "terminal-ambiguity";

export type StreamWartId =
	| typeof WART_START_AS_DELTA
	| typeof WART_FINAL_WITHOUT_DELTAS
	| typeof WART_DANGLING_AT_TERMINAL
	| typeof WART_TERMINAL_AMBIGUITY;

export interface WartInfo {
	id: StreamWartId;
	description: string;
	docRef: string;
}

export const V1_WARTS: readonly WartInfo[] = [
	{
		id: WART_START_AS_DELTA,
		description:
			"text/reasoning content_start repeats per delta (start means delta in v1)",
		docRef: "agent-event-stream-design.md, P1; runtime-event-adapter.ts:202",
	},
	{
		id: WART_FINAL_WITHOUT_DELTAS,
		description:
			"content_end(text/reasoning) with no prior content_start in the iteration",
		docRef: "agent-event-stream-design.md, P2; sidecar/context.ts:310",
	},
	{
		id: WART_DANGLING_AT_TERMINAL,
		description:
			"iteration or tool block still open at done/error (v1 has no force-close)",
		docRef: "agent-event-stream-design.md, Edge cases; runtime-event-adapter.ts:276",
	},
	{
		id: WART_TERMINAL_AMBIGUITY,
		description:
			"recoverable error reusing the terminal error discriminant, or done(reason:'error') without an error event",
		docRef: "agent-event-stream-design.md, P6; message-translator.ts:1865",
	},
];

export interface StreamWartObservation {
	id: StreamWartId;
	count: number;
}

export interface StreamValidationResult {
	violations: StreamViolation[];
	warts: StreamWartObservation[];
	/** True when a terminal event was seen. */
	terminated: boolean;
	/** Total events inspected. */
	eventCount: number;
}

// =============================================================================
// Validator — fold over the v1 tables
// =============================================================================

interface OpenTool {
	/** Iteration number the tool opened in. */
	iteration: number;
}

/**
 * Validate an AgentEvent trace against the v1 de-facto grammar.
 *
 * The input is the per-agent projection of a session's events (for
 * RuntimeEventAdapter output, the whole stream; for multiplexed
 * CoreSessionEvents, project by agent path first — this validator does
 * one language-2 stream, not the demultiplex).
 *
 * A prefix without a terminal is legal: streaming traces may be
 * validated at any point. Violations are producer bugs; warts are
 * expected v1 behavior and are counted, never fatal.
 */
export function validateAgentEventStream(
	events: readonly AgentEvent[],
): StreamValidationResult {
	const violations: StreamViolation[] = [];
	const wartCounts = new Map<StreamWartId, number>();
	const noteWart = (id: StreamWartId): void => {
		wartCounts.set(id, (wartCounts.get(id) ?? 0) + 1);
	};

	let terminated = false;
	let openIteration: number | undefined;
	let lastEndedIteration = 0;
	const openTools = new Map<string, OpenTool>();
	let textStartsInIteration = 0;
	let reasoningStartsInIteration = 0;
	let sawTerminalError = false;

	const violation = (
		index: number,
		event: AgentEvent,
		code: StreamViolationCode,
		detail?: string,
	): void => {
		violations.push({ code, index, eventType: event.type, detail });
	};

	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		if (terminated) {
			violation(index, event, DOUBLE_TERMINAL);
			continue;
		}

		switch (event.type) {
			case "iteration_start": {
				if (openIteration !== undefined) {
					violation(index, event, ITERATION_OVERLAP);
				}
				if (event.iteration <= lastEndedIteration) {
					violation(index, event, ITERATION_REGRESSION);
				}
				openIteration = event.iteration;
				textStartsInIteration = 0;
				reasoningStartsInIteration = 0;
				break;
			}
			case "iteration_end": {
				if (openIteration === undefined) {
					violation(index, event, ITERATION_END_WITHOUT_START);
					break;
				}
				for (const [toolCallId, tool] of openTools) {
					if (tool.iteration === openIteration) {
						violation(
							index,
							event,
							TOOL_OPEN_AT_ITERATION_END,
							toolCallId,
						);
					}
				}
				lastEndedIteration = Math.max(lastEndedIteration, openIteration);
				openIteration = undefined;
				break;
			}
			case "content_start": {
				if (openIteration === undefined) {
					violation(index, event, CONTENT_OUTSIDE_ITERATION);
					break;
				}
				if (event.contentType === "tool") {
					if (event.toolCallId === undefined) {
						violation(
							index,
							event,
							TOOL_OPEN_WHILE_OPEN,
							"(missing toolCallId)",
						);
						break;
					}
					if (openTools.has(event.toolCallId)) {
						violation(
							index,
							event,
							TOOL_OPEN_WHILE_OPEN,
							event.toolCallId,
						);
						break;
					}
					openTools.set(event.toolCallId, {
						iteration: openIteration,
					});
				} else if (event.contentType === "text") {
					textStartsInIteration += 1;
					noteWart(WART_START_AS_DELTA);
				} else if (event.contentType === "reasoning") {
					reasoningStartsInIteration += 1;
					noteWart(WART_START_AS_DELTA);
				}
				// media arrives whole on content_end; the v1 adapter
				// never emits a media content_start.
				break;
			}
			case "content_update": {
				if (openIteration === undefined) {
					violation(index, event, CONTENT_OUTSIDE_ITERATION);
					break;
				}
				const toolCallId = event.toolCallId;
				const tool = toolCallId === undefined ? undefined : openTools.get(toolCallId);
				if (tool === undefined) {
					violation(
						index,
						event,
						TOOL_UPDATE_WITHOUT_OPEN,
						toolCallId ?? "(missing toolCallId)",
					);
					break;
				}
				if (tool.iteration !== openIteration) {
					violation(
						index,
						event,
						TOOL_WRONG_ITERATION,
						event.toolCallId,
					);
				}
				break;
			}
			case "content_end": {
				if (openIteration === undefined) {
					violation(index, event, CONTENT_OUTSIDE_ITERATION);
					break;
				}
				if (event.contentType === "tool") {
					const toolCallId = event.toolCallId;
					const tool =
						toolCallId === undefined ? undefined : openTools.get(toolCallId);
					if (tool === undefined) {
						violation(
							index,
							event,
							TOOL_END_WITHOUT_OPEN,
							toolCallId ?? "(missing toolCallId)",
						);
						break;
					}
					if (tool.iteration !== openIteration) {
						violation(
							index,
							event,
							TOOL_WRONG_ITERATION,
							event.toolCallId,
						);
					}
					if (toolCallId !== undefined) {
						openTools.delete(toolCallId);
					}
				} else if (event.contentType === "text") {
					if (textStartsInIteration === 0) {
						noteWart(WART_FINAL_WITHOUT_DELTAS);
					}
				} else if (event.contentType === "reasoning") {
					if (reasoningStartsInIteration === 0) {
						noteWart(WART_FINAL_WITHOUT_DELTAS);
					}
				}
				break;
			}
			case "notice":
			case "usage": {
				// Notices (status, recovery, mistake-limit) and usage
				// deltas are legal anywhere before the terminal.
				break;
			}
			case "error": {
				if (event.recoverable) {
					// In-run error reusing the terminal discriminant.
					noteWart(WART_TERMINAL_AMBIGUITY);
					break;
				}
				terminated = true;
				sawTerminalError = true;
				if (openIteration !== undefined || openTools.size > 0) {
					noteWart(WART_DANGLING_AT_TERMINAL);
				}
				break;
			}
			case "done": {
				terminated = true;
				if (event.reason === "error" && !sawTerminalError) {
					// Terminal outcome spelled as done(reason:"error")
					// rather than an error event.
					noteWart(WART_TERMINAL_AMBIGUITY);
				}
				if (openIteration !== undefined || openTools.size > 0) {
					noteWart(WART_DANGLING_AT_TERMINAL);
				}
				break;
			}
			default: {
				// Exhaustiveness guard: a new AgentEvent variant must
				// be added to the tables or this assignment fails to
				// compile — a validator that silently ignores an event
				// kind is worse than none.
				const _exhaustive: never = event;
				void _exhaustive;
			}
		}
	}

	const warts: StreamWartObservation[] = V1_WARTS.map((wart) => ({
		id: wart.id,
		count: wartCounts.get(wart.id) ?? 0,
	})).filter((wart) => wart.count > 0);

	return {
		violations,
		warts,
		terminated,
		eventCount: events.length,
	};
}
