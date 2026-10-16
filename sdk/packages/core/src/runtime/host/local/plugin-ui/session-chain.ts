import {
	PLUGIN_UI_LIMITS,
	type PluginUiSlot,
	type PluginUiSurface,
	type PluginUiViewer,
} from "@cline/shared";

export interface SlotActivity {
	attaches: number;
	detaches: number;
	exposed: number;
	keyInert: number;
	peakViewers: number;
	surfaces: Set<PluginUiSurface>;
}

/**
 * One session epoch's UI chain. Invokes run on it one at a time, apart from
 * any other plugin call, so a slow slash command never freezes the tray.
 */
export interface SessionUiChain {
	epoch: number;
	tail: Promise<unknown>;
	closing: boolean;
	closed?: Promise<void>;
	/** Ordinary invokes still waiting for their turn; closing answers them at once. */
	waiting: Set<() => void>;
	tokens: number;
	tokensAt: number;
	/** The slot each viewer last attached through, where its synthesized detach goes. */
	attachedSlots: Map<string, PluginUiSlot>;
	/**
	 * Attaches whose turn has not finished. Until a turn records the lease, a
	 * hub disconnect finds the attach here instead of in the store.
	 */
	queuedAttaches: Set<QueuedAttach>;
	activity: Map<PluginUiSlot, SlotActivity>;
}

export interface QueuedAttach {
	viewer: PluginUiViewer;
	connectionId?: string;
}

/**
 * A detach core synthesizes, at teardown or on a hub disconnect (carrying
 * that connection). It skips the rate limit, the closing checks and the
 * arrival deadline, and is dropped when its lease is gone or has moved to
 * another connection.
 */
export interface SystemDetach {
	connectionId?: string;
}

export interface PerformOptions {
	connectionId?: string;
	deadline?: Deadline;
	system?: SystemDetach;
}

/** Resolves `reached` once `ms` pass, unless cancelled first. */
export class Deadline {
	expired = false;
	readonly reached: Promise<undefined>;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(ms: number) {
		this.reached = new Promise((resolve) => {
			this.timer = setTimeout(() => {
				this.expired = true;
				resolve(undefined);
			}, ms);
			this.timer.unref?.();
		});
	}

	cancel(): void {
		clearTimeout(this.timer);
	}
}

export function createSessionUiChain(
	epoch: number,
	now: number,
): SessionUiChain {
	return {
		epoch,
		tail: Promise.resolve(),
		closing: false,
		waiting: new Set(),
		tokens: PLUGIN_UI_LIMITS.invokeBurst,
		tokensAt: now,
		attachedSlots: new Map(),
		queuedAttaches: new Set(),
		activity: new Map(),
	};
}

export function enqueue<T>(
	chain: SessionUiChain,
	work: () => Promise<T>,
): Promise<T> {
	const run = chain.tail.then(work);
	chain.tail = run.catch(() => undefined);
	return run;
}

/** With no `connectionId`, an attach through any connection matches, as the store's leases do. */
export function findQueuedAttach(
	chain: SessionUiChain,
	viewerId: string,
	connectionId: string | undefined,
): QueuedAttach | undefined {
	for (const queued of chain.queuedAttaches) {
		if (
			queued.viewer.id === viewerId &&
			(connectionId === undefined || queued.connectionId === connectionId)
		) {
			return queued;
		}
	}
	return undefined;
}

export function takeToken(chain: SessionUiChain, now: number): boolean {
	const refilled =
		((now - chain.tokensAt) / 1000) * PLUGIN_UI_LIMITS.invokesPerSecond;
	chain.tokens = Math.min(
		PLUGIN_UI_LIMITS.invokeBurst,
		chain.tokens + Math.max(0, refilled),
	);
	chain.tokensAt = now;
	if (chain.tokens < 1) return false;
	chain.tokens -= 1;
	return true;
}

export function activityFor(
	chain: SessionUiChain,
	slot: PluginUiSlot,
): SlotActivity {
	let activity = chain.activity.get(slot);
	if (!activity) {
		activity = {
			attaches: 0,
			detaches: 0,
			exposed: 0,
			keyInert: 0,
			peakViewers: 0,
			surfaces: new Set(),
		};
		chain.activity.set(slot, activity);
	}
	return activity;
}
