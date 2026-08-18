/**
 * Backpressure for monitor-originated steer prompts.
 *
 * A monitor reports whenever its watched process prints something, which the
 * process controls and the user does not. Enqueuing each report directly would
 * let a chatty log grow the pending queue without bound and, while the session
 * is idle, start one paid model turn per report.
 *
 * Two mechanisms keep that bounded without losing anything the agent has not
 * seen yet:
 *
 * - **Merge into the outstanding prompt.** While an earlier monitor report is
 *   still queued and unconsumed, later reports are folded into it. The queue
 *   therefore holds at most one monitor prompt per session no matter how much
 *   output arrives.
 * - **Cooldown between fresh prompts.** Once a report is consumed, the next one
 *   waits out a minimum interval before it can enqueue again. Output produced
 *   during the cooldown accumulates and is delivered as a single prompt when it
 *   expires, so turn starts are paced by wall-clock rather than by how fast the
 *   watched process writes.
 */

import type { SessionPendingPrompt } from "../../types/events";

export interface MonitorSteerQueueDeps {
	list(sessionId: string): SessionPendingPrompt[];
	enqueue(
		sessionId: string,
		entry: { prompt: string; delivery: "steer" },
	): void;
	update(input: {
		sessionId: string;
		promptId: string;
		prompt: string;
	}): unknown;
	/** Injectable for tests. */
	now?: () => number;
}

export interface MonitorSteerQueueOptions {
	/**
	 * Minimum gap between monitor prompts that can start a turn.
	 * @default 5000
	 */
	cooldownMs?: number;
	/**
	 * Cap on a merged prompt. Older text is dropped first so the agent always
	 * sees the most recent output.
	 * @default 16000
	 */
	maxMergedChars?: number;
}

interface SessionState {
	outstandingId?: string;
	lastEnqueuedAt: number;
	buffered?: string;
	timer?: NodeJS.Timeout;
}

const DEFAULT_COOLDOWN_MS = 5_000;
const DEFAULT_MAX_MERGED_CHARS = 16_000;
const DROPPED_PREFIX = "[older monitor output dropped to bound this update]";

export class MonitorSteerQueue {
	private readonly sessions = new Map<string, SessionState>();

	constructor(
		private readonly deps: MonitorSteerQueueDeps,
		private readonly options: MonitorSteerQueueOptions = {},
	) {}

	private get cooldownMs(): number {
		return this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
	}

	private get maxMergedChars(): number {
		return this.options.maxMergedChars ?? DEFAULT_MAX_MERGED_CHARS;
	}

	private now(): number {
		return this.deps.now?.() ?? Date.now();
	}

	/** Delivers one formatted monitor notification, merging or pacing as needed. */
	deliver(sessionId: string, text: string): void {
		const state = this.sessions.get(sessionId) ?? {
			lastEnqueuedAt: Number.NEGATIVE_INFINITY,
		};
		this.sessions.set(sessionId, state);

		// An unconsumed monitor prompt is still sitting in the queue: fold this
		// report into it rather than adding a second one.
		const outstanding = this.findOutstanding(sessionId, state);
		if (outstanding) {
			this.deps.update({
				sessionId,
				promptId: outstanding.id,
				prompt: this.merge(outstanding.prompt, text),
			});
			return;
		}

		const elapsed = this.now() - state.lastEnqueuedAt;
		if (elapsed < this.cooldownMs) {
			state.buffered = state.buffered ? this.merge(state.buffered, text) : text;
			if (!state.timer) {
				state.timer = setTimeout(() => {
					state.timer = undefined;
					this.flush(sessionId);
				}, this.cooldownMs - elapsed);
				state.timer.unref?.();
			}
			return;
		}

		this.enqueue(sessionId, state, text);
	}

	/** Drops all state for a session. Call on teardown so timers cannot leak. */
	forget(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (state?.timer) clearTimeout(state.timer);
		this.sessions.delete(sessionId);
	}

	/** Drops every session's state. */
	clear(): void {
		for (const sessionId of [...this.sessions.keys()]) this.forget(sessionId);
	}

	private flush(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (!state?.buffered) return;
		const text = state.buffered;
		state.buffered = undefined;

		// The agent may have gone quiet and left an earlier prompt queued while
		// this was buffering; merge rather than stacking a second one.
		const outstanding = this.findOutstanding(sessionId, state);
		if (outstanding) {
			this.deps.update({
				sessionId,
				promptId: outstanding.id,
				prompt: this.merge(outstanding.prompt, text),
			});
			return;
		}
		this.enqueue(sessionId, state, text);
	}

	private enqueue(sessionId: string, state: SessionState, text: string): void {
		this.deps.enqueue(sessionId, { prompt: text, delivery: "steer" });
		state.lastEnqueuedAt = this.now();
		// enqueue() does not hand back an id, so recover it by matching the text
		// we just submitted. A miss simply means the prompt was consumed before
		// we looked, which the outstanding check handles on the next report.
		state.outstandingId = this.deps
			.list(sessionId)
			.find((prompt) => prompt.prompt === text)?.id;
	}

	private findOutstanding(
		sessionId: string,
		state: SessionState,
	): SessionPendingPrompt | undefined {
		if (!state.outstandingId) return undefined;
		const found = this.deps
			.list(sessionId)
			.find((prompt) => prompt.id === state.outstandingId);
		if (!found) state.outstandingId = undefined;
		return found;
	}

	private merge(existing: string, addition: string): string {
		const combined = `${existing}\n\n${addition}`;
		if (combined.length <= this.maxMergedChars) return combined;
		// Keep the newest output; the agent cares about current state, and the
		// drop is stated so it never looks like a complete record.
		const kept = combined.slice(combined.length - this.maxMergedChars);
		return `${DROPPED_PREFIX}\n${kept}`;
	}
}
