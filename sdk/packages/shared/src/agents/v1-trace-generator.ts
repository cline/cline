/**
 * Deterministic legal-trace generator for the v1 AgentEvent grammar.
 *
 * Derived from the same tables as `validateAgentEventStream` (stream-
 * grammar.ts): every emitted trace is v1-legal by construction, and the
 * property test closes the loop — generate → frame → validateFrameStream
 * must be zero-violation. A seeded LCG keeps runs reproducible without
 * adding a dependency; seeds are the test's identity, so a failure can
 * be replayed exactly.
 */
import type { AgentEvent } from "./types";

/** Small deterministic PRNG (LCG) — reproducibility over quality. */
class Lcg {
	private state: number;
	constructor(seed: number) {
		this.state = (seed * 2654435761) % 2147483647 || 1;
	}
	next(): number {
		this.state = (this.state * 48271) % 2147483647;
		return this.state;
	}
	pick<T>(items: readonly T[]): T {
		return items[this.next() % items.length];
	}
}

const TEXTS = ["He", "llo", " wo", "rld", "!"];

export interface GenerateOptions {
	/** Upper bound on emitted events; traces may end earlier (terminal). */
	maxEvents?: number;
}

/**
 * Generate a random v1-legal trace. Covers the warts deliberately: text
 * deltas (W1), finals with no deltas (W2), terminals with dangling
 * scopes (W3), recoverable errors (W4), and every finish reason.
 */
export function generateLegalV1Trace(
	seed: number,
	options: GenerateOptions = {},
): AgentEvent[] {
	const maxEvents = options.maxEvents ?? 48;
	const rng = new Lcg(seed);
	const out: AgentEvent[] = [];

	let iterationOpen: number | undefined;
	let lastEndedIteration = 0;
	let nextTool = 1;
	const openTools: string[] = [];
	let terminated = false;
	/** Deltas of the currently-open text block, joined for `accumulated`. */
	const textDeltas: string[] = [];

	const iterationStart = (): void => {
		iterationOpen = lastEndedIteration + 1;
		out.push({ type: "iteration_start", iteration: iterationOpen });
	};
	const iterationEnd = (): void => {
		lastEndedIteration = iterationOpen ?? lastEndedIteration;
		out.push({
			type: "iteration_end",
			iteration: iterationOpen ?? 0,
			hadToolCalls: openTools.length > 0,
			toolCallCount: 1,
		});
		iterationOpen = undefined;
	};

	while (out.length < maxEvents && !terminated) {
		const moves: Array<() => void> = [];
		if (iterationOpen === undefined) {
			moves.push(iterationStart);
		} else {
			// Deltas are the most common real events — weight them.
			moves.push(
				(): void => {
					const delta = rng.pick(TEXTS);
					textDeltas.push(delta);
					out.push({
						type: "content_start",
						contentType: "text",
						text: delta,
						accumulated: textDeltas.join(""),
					});
				},
				(): void => {
					const delta = rng.pick(TEXTS);
					textDeltas.push(delta);
					out.push({
						type: "content_start",
						contentType: "text",
						text: delta,
						accumulated: textDeltas.join(""),
					});
				},
				(): void => {
					out.push({
						type: "content_start",
						contentType: "reasoning",
						reasoning: rng.pick(TEXTS),
						redacted: rng.next() % 4 === 0,
					});
				},
				(): void => {
					textDeltas.length = 0;
					out.push({
						type: "content_end",
						contentType: "text",
						text: "final text",
					});
				},
				(): void => {
					out.push({
						type: "content_end",
						contentType: "reasoning",
						reasoning: "final reasoning",
					});
				},
				(): void => {
					const toolCallId = `call_${nextTool}`;
					nextTool += 1;
					openTools.push(toolCallId);
					out.push({
						type: "content_start",
						contentType: "tool",
						toolCallId,
						toolName: "read_file",
						input: { path: "/tmp/x" },
					});
				},
				(): void => {
					out.push({ type: "notice", noticeType: "status", message: "t" });
				},
				(): void => {
					out.push({
						type: "usage",
						inputTokens: 1,
						outputTokens: 1,
						totalInputTokens: 1,
						totalOutputTokens: 1,
					});
				},
				(): void => {
					// W4: recoverable in-run error.
					out.push({
						type: "error",
						error: new Error("transient"),
						iteration: iterationOpen ?? 0,
						recoverable: true,
					});
				},
				(): void => {
					// Terminal. W3 occurs when tools are still open.
					if (rng.next() % 2 === 0) {
						out.push({
							type: "done",
							reason: rng.pick([
								"completed",
								"max_iterations",
								"aborted",
								"mistake_limit",
								"error",
							] as const),
							text: "done",
							iterations: 1,
						});
					} else {
						out.push({
							type: "error",
							error: new Error("fatal"),
							iteration: iterationOpen ?? 0,
							recoverable: false,
						});
					}
					terminated = true;
				},
				(): void => {
					// Close the iteration when no tool is open (v1 requires
					// tools closed before iteration_end); otherwise close a
					// tool instead.
					if (openTools.length === 0) {
						iterationEnd();
					} else {
						const index = rng.next() % openTools.length;
						const [toolCallId] = openTools.splice(index, 1);
						out.push({
							type: "content_end",
							contentType: "tool",
							toolCallId,
							toolName: "read_file",
							output: "ok",
						});
					}
				},
			);
			if (openTools.length > 0) {
				moves.push(
					(): void => {
						out.push({
							type: "content_update",
							contentType: "tool",
							toolCallId: rng.pick(openTools),
							update: { p: 1 },
						});
					},
					(): void => {
						const index = rng.next() % openTools.length;
						const [toolCallId] = openTools.splice(index, 1);
						out.push({
							type: "content_end",
							contentType: "tool",
							toolCallId,
							toolName: "read_file",
							output: "ok",
							...(rng.next() % 5 === 0 ? { error: "boom" } : {}),
						});
					},
				);
			}
		}
		moves[Math.floor(rng.next() % moves.length)]();
	}

	// A trace that reaches the bound without a terminal is a legal
	// prefix, but the property loop asserts full-turn closure; end every
	// generated trace deterministically so seeds are stable and the
	// closed-loop assertion is unconditional.
	if (!terminated) {
		out.push({ type: "done", reason: "completed", text: "done", iterations: 1 });
	}
	return out;
}
