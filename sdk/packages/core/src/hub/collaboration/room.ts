/**
 * In-memory Drive room store. Mutations append DriveEvents and fold via
 * @cline/drive reduceRoom. Hub handlers own broadcast; this module stays pure
 * except for the Map of rooms + optional durable event log (ARD-0013).
 *
 * Single live Map: director/spotlight UI state lives here — not a second
 * module-local Map in drive-handlers.
 */

import { createEmptyRoomSnapshot, reduceRoom } from "@cline/drive";
import type {
	AddressSet,
	DriveEvent,
	DriveRoomLiveState,
	DriveSubMode,
	Participant,
	RoomSnapshot,
	StagePin,
	StageSharer,
} from "@cline/shared";
import { createEmptyDriveRoomLiveState } from "@cline/shared";
import { resetDrivePauseAfterToolForTests } from "./drivePauseAfterTool";
import type { RoomEventLog } from "./eventLog";
import type { WorkRecordPayload } from "./work-from-tool";

export type RoomCommitResult = {
	snapshot: RoomSnapshot;
	event: DriveEvent;
	/** Monotonic per-room sequence when an event log is attached; else 0. */
	seq: number;
};

function nowIso(): string {
	return new Date().toISOString();
}

function newEventId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export class DriveRoomStore {
	readonly rooms = new Map<string, RoomSnapshot>();
	/** Ephemeral UI live state (spotlight / director / audio) — one Map only. */
	readonly liveByRoomId = new Map<string, DriveRoomLiveState>();
	/** Session ↔ room links for agent tool → work bridge. */
	readonly sessionToRoom = new Map<string, string>();
	readonly roomToSessions = new Map<string, Set<string>>();

	private eventLog: RoomEventLog | undefined;
	private readonly seqByRoom = new Map<string, number>();
	private readonly appliedEventIds = new Set<string>();

	attachEventLog(log: RoomEventLog): void {
		this.eventLog = log;
	}

	getEventLog(): RoomEventLog | undefined {
		return this.eventLog;
	}

	lastSeq(roomId: string): number {
		const cached = this.seqByRoom.get(roomId);
		if (cached !== undefined) {
			return cached;
		}
		return this.eventLog?.latestSeq(roomId) ?? 0;
	}

	get(roomId: string): RoomSnapshot | undefined {
		return this.rooms.get(roomId);
	}

	getOrThrow(roomId: string): RoomSnapshot {
		const snapshot = this.rooms.get(roomId);
		if (!snapshot) {
			throw new Error(`room_not_found:${roomId}`);
		}
		return snapshot;
	}

	getLive(roomId: string): DriveRoomLiveState | undefined {
		return this.liveByRoomId.get(roomId);
	}

	getOrCreateLive(roomId: string): DriveRoomLiveState {
		const existing = this.liveByRoomId.get(roomId);
		if (existing) {
			return existing;
		}
		const live = createEmptyDriveRoomLiveState(roomId);
		this.liveByRoomId.set(roomId, live);
		return live;
	}

	setLive(next: DriveRoomLiveState): DriveRoomLiveState {
		const current = this.liveByRoomId.get(next.roomId);
		const version = (current?.version ?? 0) + 1;
		const bumped = { ...next, version };
		this.liveByRoomId.set(next.roomId, bumped);
		return bumped;
	}

	create(roomId: string, createdAt = nowIso()): RoomSnapshot {
		const existing = this.rooms.get(roomId);
		if (existing) {
			return existing;
		}
		const snapshot = createEmptyRoomSnapshot({ roomId, createdAt });
		this.rooms.set(roomId, snapshot);
		this.getOrCreateLive(roomId);
		return snapshot;
	}

	linkSession(sessionId: string, roomId: string): void {
		const previous = this.sessionToRoom.get(sessionId);
		if (previous && previous !== roomId) {
			const set = this.roomToSessions.get(previous);
			set?.delete(sessionId);
		}
		this.sessionToRoom.set(sessionId, roomId);
		let sessions = this.roomToSessions.get(roomId);
		if (!sessions) {
			sessions = new Set();
			this.roomToSessions.set(roomId, sessions);
		}
		sessions.add(sessionId);
	}

	unlinkSession(sessionId: string): void {
		const roomId = this.sessionToRoom.get(sessionId);
		if (!roomId) {
			return;
		}
		this.sessionToRoom.delete(sessionId);
		this.roomToSessions.get(roomId)?.delete(sessionId);
	}

	getRoomIdForSession(sessionId: string): string | undefined {
		return this.sessionToRoom.get(sessionId);
	}

	/**
	 * Append to durable log (when attached), then fold into live snapshot.
	 * Idempotent on event.id within this process. Does not create rooms —
	 * callers must create/join first.
	 */
	commit(event: DriveEvent): RoomCommitResult {
		if (this.appliedEventIds.has(event.id)) {
			return {
				snapshot: this.getOrThrow(event.roomId),
				event,
				seq: this.lastSeq(event.roomId),
			};
		}
		let seq = 0;
		if (this.eventLog) {
			const record = this.eventLog.appendSync(event.roomId, event);
			seq = record.seq;
			this.seqByRoom.set(event.roomId, seq);
		}
		const current = this.getOrThrow(event.roomId);
		const next = reduceRoom(current, event);
		this.rooms.set(event.roomId, next);
		this.appliedEventIds.add(event.id);
		this.syncLiveFromSnapshot(next);
		return { snapshot: next, event, seq };
	}

	/**
	 * Rebuild snapshot from the event log (hub restart / cold join).
	 * Does not re-append; folds only.
	 */
	async hydrateFromLog(roomId: string): Promise<RoomSnapshot | undefined> {
		const log = this.eventLog;
		if (!log) {
			return undefined;
		}
		const records = await log.readSince(roomId, 0);
		if (records.length === 0) {
			return undefined;
		}
		const first = records[0];
		if (!first) {
			return undefined;
		}
		this.create(roomId, first.event.at);
		let snapshot = this.getOrThrow(roomId);
		for (const record of records) {
			if (this.appliedEventIds.has(record.event.id)) {
				continue;
			}
			snapshot = reduceRoom(snapshot, record.event);
			this.rooms.set(roomId, snapshot);
			this.appliedEventIds.add(record.event.id);
			this.seqByRoom.set(roomId, record.seq);
		}
		this.syncLiveFromSnapshot(snapshot);
		return snapshot;
	}

	/** Sync hydrate for command handlers (JSONL / memory are sync). */
	hydrateFromLogSync(roomId: string): RoomSnapshot | undefined {
		const log = this.eventLog;
		if (!log) {
			return undefined;
		}
		const records = log.readSinceSync(roomId, 0);
		if (records.length === 0) {
			return undefined;
		}
		const first = records[0];
		if (!first) {
			return undefined;
		}
		this.create(roomId, first.event.at);
		let snapshot = this.getOrThrow(roomId);
		for (const record of records) {
			if (this.appliedEventIds.has(record.event.id)) {
				continue;
			}
			snapshot = reduceRoom(snapshot, record.event);
			this.rooms.set(roomId, snapshot);
			this.appliedEventIds.add(record.event.id);
			this.seqByRoom.set(roomId, record.seq);
		}
		this.syncLiveFromSnapshot(snapshot);
		return snapshot;
	}

	private syncLiveFromSnapshot(snapshot: RoomSnapshot): void {
		const live = this.getOrCreateLive(snapshot.roomId);
		const byId = new Map(
			live.participantAudio.map((a) => [a.participantId, a] as const),
		);
		for (const p of snapshot.participants) {
			const prev = byId.get(p.id);
			byId.set(p.id, {
				participantId: p.id,
				muted: snapshot.muteByParticipantId[p.id] === true,
				deafened: prev?.deafened ?? false,
			});
		}
		for (const [participantId, muted] of Object.entries(
			snapshot.muteByParticipantId,
		)) {
			if (!muted) {
				continue;
			}
			const prev = byId.get(participantId);
			byId.set(participantId, {
				participantId,
				muted: true,
				deafened: prev?.deafened ?? false,
			});
		}
		const seatedParticipantIds =
			snapshot.participants.length > 0
				? snapshot.participants.map((p) => p.id)
				: live.seatedParticipantIds;
		/** Stage sharer is the authority for who presents (S1 converge). */
		const sharerId = snapshot.stage.sharer?.participantId ?? null;
		this.setLive({
			...live,
			seatedParticipantIds,
			participantAudio: [...byId.values()],
			spotlightParticipantId: sharerId,
			director: {
				...live.director,
				spotlightParticipantId: sharerId,
			},
		});
	}

	join(input: {
		roomId: string;
		participant: Participant;
		actorId?: string;
		at?: string;
		sessionId?: string;
	}): RoomCommitResult {
		this.create(input.roomId, input.at);
		if (input.sessionId) {
			this.linkSession(input.sessionId, input.roomId);
		}
		return this.commit({
			schemaVersion: 1,
			id: newEventId("join"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId ?? input.participant.id,
			type: "control.join",
			track: "control",
			participant: input.participant,
		});
	}

	leave(input: {
		roomId: string;
		participantId: string;
		reason?: string;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		return this.commit({
			schemaVersion: 1,
			id: newEventId("leave"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId ?? input.participantId,
			type: "control.leave",
			track: "control",
			participantId: input.participantId,
			reason: input.reason,
		});
	}

	mute(input: {
		roomId: string;
		participantId: string;
		muted: boolean;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		return this.commit({
			schemaVersion: 1,
			id: newEventId("mute"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId ?? input.participantId,
			type: "control.mute",
			track: "control",
			participantId: input.participantId,
			muted: input.muted,
		});
	}

	setStage(input: {
		roomId: string;
		sharer: StageSharer | null;
		pin?: StagePin | null;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		return this.commit({
			schemaVersion: 1,
			id: newEventId("stage"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId,
			type: "control.stage",
			track: "control",
			sharer: input.sharer,
			...(input.pin !== undefined ? { pin: input.pin } : {}),
		});
	}

	setAddress(input: {
		roomId: string;
		addressSet: AddressSet;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		return this.commit({
			schemaVersion: 1,
			id: newEventId("address"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId,
			type: "control.address",
			track: "control",
			addressSet: input.addressSet,
		});
	}

	setMode(input: {
		roomId: string;
		subMode: DriveSubMode;
		driveActive?: boolean;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		return this.commit({
			schemaVersion: 1,
			id: newEventId("mode"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId,
			type: "control.mode",
			track: "control",
			subMode: input.subMode,
			driveActive: input.driveActive,
		});
	}

	raiseHand(input: {
		roomId: string;
		participantId: string;
		raised: boolean;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		return this.commit({
			schemaVersion: 1,
			id: newEventId("hand"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId ?? input.participantId,
			type: "control.raise_hand",
			track: "control",
			participantId: input.participantId,
			raised: input.raised,
		});
	}

	renameParticipant(input: {
		roomId: string;
		participantId: string;
		displayName: string;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		const snapshot = this.getOrThrow(input.roomId);
		const seated = snapshot.participants.some(
			(participant) => participant.id === input.participantId,
		);
		if (!seated) {
			throw new Error(`participant_not_found:${input.participantId}`);
		}
		const displayName = input.displayName.trim();
		if (!displayName) {
			throw new Error("display_name_required");
		}
		return this.commit({
			schemaVersion: 1,
			id: newEventId("rename"),
			roomId: input.roomId,
			at: input.at ?? nowIso(),
			actorId: input.actorId ?? input.participantId,
			type: "control.rename",
			track: "control",
			participantId: input.participantId,
			displayName,
		});
	}

	recordWork(input: {
		roomId: string;
		work: WorkRecordPayload;
		actorId?: string;
		at?: string;
		eventId?: string;
	}): RoomCommitResult {
		const at = input.at ?? nowIso();
		const id = input.eventId ?? newEventId("work");
		const actorId = input.actorId;
		switch (input.work.kind) {
			case "edit":
				return this.commit({
					schemaVersion: 1,
					id,
					roomId: input.roomId,
					at,
					actorId,
					type: "work.edit",
					track: "work",
					path: input.work.path,
					summary: input.work.summary,
				});
			case "command":
				return this.commit({
					schemaVersion: 1,
					id,
					roomId: input.roomId,
					at,
					actorId,
					type: "work.command",
					track: "work",
					command: input.work.command,
					failed: input.work.failed,
					exitCode: input.work.exitCode,
				});
			case "test_result":
				return this.commit({
					schemaVersion: 1,
					id,
					roomId: input.roomId,
					at,
					actorId,
					type: "work.test_result",
					track: "work",
					label: input.work.label,
					passed: input.work.passed,
					summary: input.work.summary,
				});
			default: {
				const _exhaustive: never = input.work;
				return _exhaustive;
			}
		}
	}
}

/** Process-wide store for the hub daemon (single writer). */
let globalStore: DriveRoomStore | undefined;

export function getDriveRoomStore(): DriveRoomStore {
	if (!globalStore) {
		globalStore = new DriveRoomStore();
	}
	return globalStore;
}

export function resetDriveRoomStoreForTests(): void {
	globalStore = new DriveRoomStore();
	resetDrivePauseAfterToolForTests();
}
