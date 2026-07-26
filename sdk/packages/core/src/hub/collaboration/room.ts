/**
 * In-memory Drive room store. Mutations append DriveEvents and fold via
 * @cline/drive reduceRoom. Hub handlers own broadcast; this module stays pure
 * except for the Map of rooms.
 */

import {
	createEmptyRoomSnapshot,
	reduceRoom,
} from "@cline/drive";
import type {
	DriveEvent,
	DriveSubMode,
	Participant,
	RoomSnapshot,
	StagePin,
	StageSharer,
} from "@cline/shared";

export type RoomCommitResult = {
	snapshot: RoomSnapshot;
	event: DriveEvent;
};

function nowIso(): string {
	return new Date().toISOString();
}

function newEventId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export class DriveRoomStore {
	readonly rooms = new Map<string, RoomSnapshot>();

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

	create(roomId: string, createdAt = nowIso()): RoomSnapshot {
		const existing = this.rooms.get(roomId);
		if (existing) {
			return existing;
		}
		const snapshot = createEmptyRoomSnapshot({ roomId, createdAt });
		this.rooms.set(roomId, snapshot);
		return snapshot;
	}

	commit(event: DriveEvent): RoomCommitResult {
		const current = this.getOrThrow(event.roomId);
		const next = reduceRoom(current, event);
		this.rooms.set(event.roomId, next);
		return { snapshot: next, event };
	}

	join(input: {
		roomId: string;
		participant: Participant;
		actorId?: string;
		at?: string;
	}): RoomCommitResult {
		this.create(input.roomId, input.at);
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
}
