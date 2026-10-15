import {
	normalizePluginUiState,
	PLUGIN_UI_LIMITS,
	type PluginUiDropReason,
	type PluginUiSlot,
	type PluginUiState,
	type PluginUiStateEnvelope,
	type PluginUiViewer,
} from "@cline/shared";

export interface PluginUiStateDrop {
	sessionId: string;
	plugin: string;
	slot: string;
	reason: PluginUiDropReason;
}

export interface PluginUiStorePush {
	plugin: string;
	slot: unknown;
	state: unknown;
}

export interface PluginUiStoreOptions {
	emit(envelope: PluginUiStateEnvelope): void;
	onDrop(drop: PluginUiStateDrop): void;
	now?: () => number;
	/** Leading and trailing throttle per (session, slot). */
	throttleMs?: number;
}

interface SlotRecord {
	/** The first plugin that pushed to or was invoked for the slot; it owns it for the epoch. */
	owner?: string;
	envelope?: PluginUiStateEnvelope;
	storedJson?: string;
	storedAt?: number;
	/** The latest push inside the throttle window, stored when the timer fires. */
	pending?: { state: PluginUiState | null; json: string };
	timer?: ReturnType<typeof setTimeout>;
	seq: number;
	notOwnerReported: boolean;
}

interface ViewerLease {
	viewer: PluginUiViewer;
	/** The hub connection that attached; a lease may only be removed through it. */
	connectionId?: string;
}

interface SessionUi {
	epoch: number;
	slots: readonly PluginUiSlot[];
	/** Until the session is resident, writes are stored and stamped but not emitted. */
	active: boolean;
	records: Map<PluginUiSlot, SlotRecord>;
	leases: Map<string, ViewerLease>;
}

/**
 * The last state of every plugin UI slot of every session, normalized,
 * owned by one plugin and ordered by `(epoch, seq)`. Synchronous; never throws.
 */
export class PluginUiStore {
	private readonly sessions = new Map<string, SessionUi>();
	/** Survives `end`, so a restart under the same id always mints a later epoch, even after the clock steps back. */
	private readonly lastEpoch = new Map<string, number>();
	private readonly now: () => number;
	private readonly throttleMs: number;

	constructor(private readonly options: PluginUiStoreOptions) {
		this.now = options.now ?? Date.now;
		this.throttleMs = options.throttleMs ?? PLUGIN_UI_LIMITS.pushIntervalMs;
	}

	/** Starts a new epoch for the session; `slots` is its catalog, already read. */
	begin(sessionId: string, slots: readonly PluginUiSlot[]): number {
		const previous = this.sessions.get(sessionId);
		if (previous) this.clearTimers(previous);
		const epoch = Math.max(
			this.now(),
			(this.lastEpoch.get(sessionId) ?? 0) + 1,
		);
		this.lastEpoch.set(sessionId, epoch);
		this.sessions.set(sessionId, {
			epoch,
			slots: [...slots],
			active: false,
			records: new Map(),
			leases: new Map(),
		});
		return epoch;
	}

	/** Marks the session resident and emits each stored envelope once, tombstones included. */
	activate(sessionId: string, epoch: number): void {
		const ui = this.sessionAt(sessionId, epoch);
		if (!ui || ui.active) return;
		ui.active = true;
		for (const record of ui.records.values()) {
			if (record.envelope) this.emit(record.envelope);
		}
	}

	epoch(sessionId: string): number | undefined {
		return this.sessions.get(sessionId)?.epoch;
	}

	slots(sessionId: string): readonly PluginUiSlot[] {
		return this.sessions.get(sessionId)?.slots ?? [];
	}

	record(sessionId: string, epoch: number, push: PluginUiStorePush): void {
		const ui = this.sessionAt(sessionId, epoch);
		if (!ui) {
			this.drop(sessionId, push, "stale_epoch");
			return;
		}
		const normalized = normalizePluginUiState(push.slot, push.state);
		if (!normalized.ok) {
			this.drop(sessionId, push, normalized.reason);
			return;
		}
		const record = this.slotRecord(ui, normalized.slot);
		record.owner ??= push.plugin;
		if (record.owner !== push.plugin) {
			if (!record.notOwnerReported) {
				record.notOwnerReported = true;
				this.drop(sessionId, push, "not_owner");
			}
			return;
		}
		this.write(sessionId, ui, normalized.slot, record, normalized.state);
	}

	/** Clears every slot the plugin owns with a `state: null` tombstone. */
	clearPlugin(sessionId: string, plugin: string): void {
		const ui = this.sessions.get(sessionId);
		if (!ui) return;
		for (const [slot, record] of ui.records) {
			if (record.owner !== plugin) continue;
			this.cancelPending(record);
			if (record.storedJson !== "null") {
				this.store(sessionId, ui, slot, record, null, "null");
			}
		}
	}

	/** Every slot of the session that has state, tombstones included; pending pushes are flushed first. */
	get(sessionId: string): PluginUiStateEnvelope[] {
		const ui = this.sessions.get(sessionId);
		if (!ui) return [];
		const envelopes: PluginUiStateEnvelope[] = [];
		for (const [slot, record] of ui.records) {
			this.flush(sessionId, ui, slot, record);
			if (record.envelope) envelopes.push(record.envelope);
		}
		return envelopes;
	}

	/** The slot's envelope, with its pending push flushed first. */
	current(
		sessionId: string,
		slot: PluginUiSlot,
	): PluginUiStateEnvelope | undefined {
		const ui = this.sessions.get(sessionId);
		const record = ui?.records.get(slot);
		if (!ui || !record) return undefined;
		this.flush(sessionId, ui, slot, record);
		return record.envelope;
	}

	owner(sessionId: string, slot: PluginUiSlot): string | undefined {
		return this.sessions.get(sessionId)?.records.get(slot)?.owner;
	}

	/** Makes `plugin` the slot's owner unless another plugin already owns it. */
	claim(sessionId: string, slot: PluginUiSlot, plugin: string): boolean {
		const ui = this.sessions.get(sessionId);
		if (!ui) return false;
		const record = this.slotRecord(ui, slot);
		record.owner ??= plugin;
		return record.owner === plugin;
	}

	/** One lease per (session, viewer id); a re-attach overwrites the lease's connection. Returns the count. */
	attachViewer(
		sessionId: string,
		viewer: PluginUiViewer,
		connectionId?: string,
	): number {
		const ui = this.sessions.get(sessionId);
		if (!ui) return 0;
		ui.leases.set(viewer.id, { viewer: { ...viewer }, connectionId });
		return ui.leases.size;
	}

	/**
	 * Removes the viewer's lease and returns the count left. With a
	 * `connectionId`, only a lease that still came through that connection is
	 * removed. Returns undefined, changing nothing, when no lease matches.
	 */
	detachViewer(
		sessionId: string,
		viewerId: string,
		connectionId?: string,
	): number | undefined {
		const ui = this.sessions.get(sessionId);
		const lease = ui?.leases.get(viewerId);
		if (!ui || !lease) return undefined;
		if (connectionId !== undefined && lease.connectionId !== connectionId) {
			return undefined;
		}
		ui.leases.delete(viewerId);
		return ui.leases.size;
	}

	/** With a `connectionId`, only sessions whose lease for this viewer came through that connection. */
	sessionsViewedBy(viewerId: string, connectionId?: string): string[] {
		const sessionIds: string[] = [];
		for (const [sessionId, ui] of this.sessions) {
			const lease = ui.leases.get(viewerId);
			if (!lease) continue;
			if (connectionId !== undefined && lease.connectionId !== connectionId) {
				continue;
			}
			sessionIds.push(sessionId);
		}
		return sessionIds;
	}

	viewer(sessionId: string, viewerId: string): PluginUiViewer | undefined {
		return this.sessions.get(sessionId)?.leases.get(viewerId)?.viewer;
	}

	viewers(sessionId: string): PluginUiViewer[] {
		const ui = this.sessions.get(sessionId);
		return ui ? [...ui.leases.values()].map((lease) => lease.viewer) : [];
	}

	/** Flushes pending pushes, then drops the epoch's entries, timers and viewers. */
	end(sessionId: string, epoch: number): void {
		const ui = this.sessionAt(sessionId, epoch);
		if (!ui) return;
		for (const [slot, record] of ui.records) {
			this.flush(sessionId, ui, slot, record);
		}
		this.clearTimers(ui);
		this.sessions.delete(sessionId);
	}

	private sessionAt(sessionId: string, epoch: number): SessionUi | undefined {
		const ui = this.sessions.get(sessionId);
		return ui?.epoch === epoch ? ui : undefined;
	}

	private slotRecord(ui: SessionUi, slot: PluginUiSlot): SlotRecord {
		let record = ui.records.get(slot);
		if (!record) {
			record = { seq: 0, notOwnerReported: false };
			ui.records.set(slot, record);
		}
		return record;
	}

	/** Last write wins: a push equal to the latest value is dropped without a new seq. */
	private write(
		sessionId: string,
		ui: SessionUi,
		slot: PluginUiSlot,
		record: SlotRecord,
		state: PluginUiState | null,
	): void {
		const json = JSON.stringify(state);
		if (json === (record.pending?.json ?? record.storedJson)) return;
		if (json === record.storedJson) {
			this.cancelPending(record);
			return;
		}
		const sinceStore =
			record.storedAt === undefined
				? Number.POSITIVE_INFINITY
				: this.now() - record.storedAt;
		if (
			!ui.active ||
			(record.timer === undefined && sinceStore >= this.throttleMs)
		) {
			this.store(sessionId, ui, slot, record, state, json);
			return;
		}
		record.pending = { state, json };
		if (record.timer === undefined) {
			record.timer = setTimeout(
				() => {
					record.timer = undefined;
					if (this.sessions.get(sessionId) !== ui) return;
					this.flush(sessionId, ui, slot, record);
				},
				Math.max(0, this.throttleMs - sinceStore),
			);
			record.timer.unref?.();
		}
	}

	private flush(
		sessionId: string,
		ui: SessionUi,
		slot: PluginUiSlot,
		record: SlotRecord,
	): void {
		const pending = record.pending;
		this.cancelPending(record);
		if (pending) {
			this.store(sessionId, ui, slot, record, pending.state, pending.json);
		}
	}

	private store(
		sessionId: string,
		ui: SessionUi,
		slot: PluginUiSlot,
		record: SlotRecord,
		state: PluginUiState | null,
		json: string,
	): void {
		record.seq += 1;
		record.storedJson = json;
		record.storedAt = this.now();
		record.envelope = {
			sessionId,
			slot,
			plugin: record.owner ?? "",
			epoch: ui.epoch,
			seq: record.seq,
			state,
		};
		if (ui.active) this.emit(record.envelope);
	}

	private cancelPending(record: SlotRecord): void {
		if (record.timer !== undefined) clearTimeout(record.timer);
		record.timer = undefined;
		record.pending = undefined;
	}

	private clearTimers(ui: SessionUi): void {
		for (const record of ui.records.values()) this.cancelPending(record);
	}

	private emit(envelope: PluginUiStateEnvelope): void {
		try {
			this.options.emit(envelope);
		} catch {
			// The host's event sink owns its own failures; the store keeps the state.
		}
	}

	private drop(
		sessionId: string,
		push: PluginUiStorePush,
		reason: PluginUiDropReason,
	): void {
		try {
			this.options.onDrop({
				sessionId,
				plugin: push.plugin,
				slot: typeof push.slot === "string" ? push.slot : String(push.slot),
				reason,
			});
		} catch {
			// Reporting a drop must never fail the push path.
		}
	}
}
