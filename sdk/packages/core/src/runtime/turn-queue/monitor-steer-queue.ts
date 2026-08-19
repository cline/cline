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
 *
 * Alongside the model-facing text (which stays fully fenced for injection
 * defense), each prompt carries a structured {@link MonitorPromptOrigin} so
 * UIs can render a clean update card instead of the fence.
 */

import {
	MONITOR_OUTPUT_CLOSE_TAG,
	MONITOR_OUTPUT_OPEN_TAG,
	MONITOR_UNTRUSTED_GUIDANCE,
} from "../../extensions/tools/executors/monitor";
import type {
	MonitorPromptOrigin,
	MonitorPromptUpdate,
	SessionPendingPrompt,
} from "../../types/events";

export interface MonitorSteerQueueDeps {
	list(sessionId: string): SessionPendingPrompt[];
	enqueue(
		sessionId: string,
		entry: {
			prompt: string;
			delivery: "steer";
			origin?: MonitorPromptOrigin;
		},
	): void;
	update(input: {
		sessionId: string;
		promptId: string;
		prompt: string;
		origin?: MonitorPromptOrigin;
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
	/**
	 * Cap on structured updates carried per prompt for UI rendering. Older
	 * updates are dropped first, mirroring the text cap.
	 * @default 20
	 */
	maxMergedUpdates?: number;
}

interface SessionState {
	outstandingId?: string;
	lastEnqueuedAt: number;
	buffered?: string;
	bufferedUpdates: MonitorPromptUpdate[];
	timer?: NodeJS.Timeout;
}

const DEFAULT_COOLDOWN_MS = 5_000;
const DEFAULT_MAX_MERGED_CHARS = 16_000;
const DEFAULT_MAX_MERGED_UPDATES = 20;
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

	private get maxMergedUpdates(): number {
		return this.options.maxMergedUpdates ?? DEFAULT_MAX_MERGED_UPDATES;
	}

	private now(): number {
		return this.deps.now?.() ?? Date.now();
	}

	/** Delivers one formatted monitor notification, merging or pacing as needed. */
	deliver(sessionId: string, text: string, update?: MonitorPromptUpdate): void {
		const state = this.sessions.get(sessionId) ?? {
			lastEnqueuedAt: Number.NEGATIVE_INFINITY,
			bufferedUpdates: [],
		};
		this.sessions.set(sessionId, state);
		const updates = update ? [update] : [];

		// An unconsumed monitor prompt is still sitting in the queue: fold this
		// report into it rather than adding a second one.
		const outstanding = this.findOutstanding(sessionId, state);
		if (outstanding) {
			this.deps.update({
				sessionId,
				promptId: outstanding.id,
				prompt: this.merge(outstanding.prompt, text),
				origin: this.mergeOrigin(originUpdates(outstanding.origin), updates),
			});
			return;
		}

		const elapsed = this.now() - state.lastEnqueuedAt;
		if (elapsed < this.cooldownMs) {
			state.buffered = state.buffered ? this.merge(state.buffered, text) : text;
			state.bufferedUpdates = this.cappedUpdates([
				...state.bufferedUpdates,
				...updates,
			]);
			if (!state.timer) {
				state.timer = setTimeout(() => {
					state.timer = undefined;
					this.flush(sessionId);
				}, this.cooldownMs - elapsed);
				state.timer.unref?.();
			}
			return;
		}

		this.enqueue(sessionId, state, text, this.mergeOrigin([], updates));
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
		const updates = state.bufferedUpdates;
		state.buffered = undefined;
		state.bufferedUpdates = [];

		// The agent may have gone quiet and left an earlier prompt queued while
		// this was buffering; merge rather than stacking a second one.
		const outstanding = this.findOutstanding(sessionId, state);
		if (outstanding) {
			this.deps.update({
				sessionId,
				promptId: outstanding.id,
				prompt: this.merge(outstanding.prompt, text),
				origin: this.mergeOrigin(originUpdates(outstanding.origin), updates),
			});
			return;
		}
		this.enqueue(sessionId, state, text, this.mergeOrigin([], updates));
	}

	private enqueue(
		sessionId: string,
		state: SessionState,
		text: string,
		origin: MonitorPromptOrigin | undefined,
	): void {
		this.deps.enqueue(sessionId, { prompt: text, delivery: "steer", origin });
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

	private mergeOrigin(
		existing: readonly MonitorPromptUpdate[],
		additions: readonly MonitorPromptUpdate[],
	): MonitorPromptOrigin | undefined {
		const updates = this.cappedUpdates([...existing, ...additions]);
		if (updates.length === 0) return undefined;
		return { kind: "monitor", updates };
	}

	private cappedUpdates(
		updates: readonly MonitorPromptUpdate[],
	): MonitorPromptUpdate[] {
		// Keep the newest updates, mirroring the text cap: the agent and the
		// user both care about current state over history.
		return updates.slice(Math.max(0, updates.length - this.maxMergedUpdates));
	}

	private merge(existing: string, addition: string): string {
		const combined = `${existing}\n\n${addition}`;
		if (combined.length <= this.maxMergedChars) return combined;
		// Keep the newest output; the agent cares about current state, and the
		// drop is stated so it never looks like a complete record.
		const kept = combined.slice(combined.length - this.maxMergedChars);
		// The cut can land inside a fenced untrusted region, which would leave
		// watched-process output unfenced at the top of the prompt — able to
		// pose as trusted framing. The fences are reliable structure markers:
		// formatMonitorNotification neutralizes anything tag-shaped inside the
		// output itself, so a close tag appearing before any open tag proves
		// the head of the kept text is mid-fence. Re-fence it, restating the
		// untrusted label the dropped framing used to carry.
		const openIndex = kept.indexOf(MONITOR_OUTPUT_OPEN_TAG);
		const closeIndex = kept.indexOf(MONITOR_OUTPUT_CLOSE_TAG);
		const startsInsideFence =
			closeIndex !== -1 && (openIndex === -1 || closeIndex < openIndex);
		if (!startsInsideFence) return `${DROPPED_PREFIX}\n${kept}`;
		return [
			DROPPED_PREFIX,
			MONITOR_UNTRUSTED_GUIDANCE,
			MONITOR_OUTPUT_OPEN_TAG,
			kept,
		].join("\n");
	}
}

function originUpdates(
	origin: SessionPendingPrompt["origin"],
): readonly MonitorPromptUpdate[] {
	return origin?.kind === "monitor" ? origin.updates : [];
}
