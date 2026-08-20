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
	/**
	 * Returns the mutation result so the queue can record the prompt text the
	 * service actually stored; the service normalizes on write (e.g. stripping
	 * user_input/user_command tags), so the submitted text is not reliable for
	 * the later user-edit comparison.
	 */
	update(input: {
		sessionId: string;
		promptId: string;
		prompt: string;
		origin?: MonitorPromptOrigin;
	}): { prompt?: { prompt: string } } | undefined | void;
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
	/**
	 * The prompt text this queue last wrote to the outstanding entry. A
	 * mismatch on the next report means the user edited the prompt, which
	 * makes it theirs: reports must stop merging into it.
	 */
	outstandingText?: string;
	lastEnqueuedAt: number;
	buffered?: string;
	bufferedUpdates: MonitorPromptUpdate[];
	/** Updates dropped from bufferedUpdates while waiting out the cooldown. */
	bufferedDropped: number;
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
			bufferedDropped: 0,
		};
		this.sessions.set(sessionId, state);
		const updates = update ? [update] : [];

		// An unconsumed monitor prompt is still sitting in the queue: fold this
		// report into it rather than adding a second one.
		const outstanding = this.findOutstanding(sessionId, state);
		if (outstanding) {
			const merged = this.merge(outstanding.prompt, text);
			const result = this.deps.update({
				sessionId,
				promptId: outstanding.id,
				prompt: merged,
				origin: this.mergeOrigin(monitorOrigin(outstanding.origin), updates),
			});
			// Record what was stored, not what was submitted: monitor output can
			// legitimately contain text the service's normalization strips, and
			// tracking the pre-normalization copy would misread that difference
			// as a user edit on the next report, permanently disowning the entry
			// and stacking a fresh prompt per cooldown.
			state.outstandingText = result?.prompt?.prompt ?? merged;
			return;
		}

		const elapsed = this.now() - state.lastEnqueuedAt;
		if (elapsed < this.cooldownMs) {
			state.buffered = state.buffered ? this.merge(state.buffered, text) : text;
			const combined = [...state.bufferedUpdates, ...updates];
			state.bufferedUpdates = this.cappedUpdates(combined);
			state.bufferedDropped += combined.length - state.bufferedUpdates.length;
			if (!state.timer) {
				state.timer = setTimeout(() => {
					state.timer = undefined;
					this.flush(sessionId);
				}, this.cooldownMs - elapsed);
				state.timer.unref?.();
			}
			return;
		}

		this.enqueue(sessionId, state, text, this.mergeOrigin(undefined, updates));
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
		const dropped = state.bufferedDropped;
		state.buffered = undefined;
		state.bufferedUpdates = [];
		state.bufferedDropped = 0;

		// The agent may have gone quiet and left an earlier prompt queued while
		// this was buffering; merge rather than stacking a second one.
		const outstanding = this.findOutstanding(sessionId, state);
		if (outstanding) {
			const merged = this.merge(outstanding.prompt, text);
			const result = this.deps.update({
				sessionId,
				promptId: outstanding.id,
				prompt: merged,
				origin: this.mergeOrigin(
					monitorOrigin(outstanding.origin),
					updates,
					dropped,
				),
			});
			// See deliver(): track the stored text, not the submitted text.
			state.outstandingText = result?.prompt?.prompt ?? merged;
			return;
		}
		this.enqueue(
			sessionId,
			state,
			text,
			this.mergeOrigin(undefined, updates, dropped),
		);
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
		state.outstandingText = state.outstandingId ? text : undefined;
	}

	private findOutstanding(
		sessionId: string,
		state: SessionState,
	): SessionPendingPrompt | undefined {
		if (!state.outstandingId) return undefined;
		const found = this.deps
			.list(sessionId)
			.find((prompt) => prompt.id === state.outstandingId);
		if (!found) {
			state.outstandingId = undefined;
			state.outstandingText = undefined;
			return undefined;
		}
		// A user edit rewrote the prompt (and cleared its monitor origin): it
		// is their prompt now. Merging into it would splice fenced monitor
		// text into what the user wrote and re-stamp the whole thing as
		// monitor-originated, so UIs would render cards and hide the user's
		// words. Disown it and let later reports enqueue a fresh prompt.
		if (found.prompt !== state.outstandingText) {
			state.outstandingId = undefined;
			state.outstandingText = undefined;
			return undefined;
		}
		return found;
	}

	private mergeOrigin(
		existing: MonitorPromptOrigin | undefined,
		additions: readonly MonitorPromptUpdate[],
		alreadyDropped = 0,
	): MonitorPromptOrigin | undefined {
		const combined = [...(existing?.updates ?? []), ...additions];
		const updates = this.cappedUpdates(combined);
		if (updates.length === 0) return undefined;
		const droppedUpdates =
			(existing?.droppedUpdates ?? 0) +
			alreadyDropped +
			(combined.length - updates.length);
		return {
			kind: "monitor",
			updates,
			...(droppedUpdates > 0 ? { droppedUpdates } : {}),
		};
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

function monitorOrigin(
	origin: SessionPendingPrompt["origin"],
): MonitorPromptOrigin | undefined {
	return origin?.kind === "monitor" ? origin : undefined;
}
