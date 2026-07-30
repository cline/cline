import type { Participant, RoomSnapshot } from "@cline/shared";
import type { DriveLaunchAction } from "./driveLaunch";
import { isDriveHumanId } from "./participantIds";
import { DRIVE_DEFAULT_ROOM_ID } from "./types";

export type DriveRoomPreviewState = "empty" | "available" | "seated";

export type DriveRoomSpotlightOwner = {
	id: string;
	kind: "human" | "agent";
	displayName: string;
};

/**
 * Compact, read-only projection of the hub-owned default Drive room.
 *
 * `empty` means the hub has no default room. `available` means the room exists
 * but the local human is not on an active call. `seated` means an active room
 * includes a human seat and can be returned to directly.
 */
export type DriveRoomPreview = {
	state: DriveRoomPreviewState;
	roomId: string;
	roster: readonly Participant[];
	spotlightOwner: DriveRoomSpotlightOwner | null;
	subMode: RoomSnapshot["subMode"];
	cardCount: number;
};

export const EMPTY_DRIVE_ROOM_PREVIEW: DriveRoomPreview = {
	state: "empty",
	roomId: DRIVE_DEFAULT_ROOM_ID,
	roster: [],
	spotlightOwner: null,
	subMode: "plan",
	cardCount: 0,
};

export function projectDriveRoomPreview(
	snapshot: RoomSnapshot,
): DriveRoomPreview {
	const humanSeated = snapshot.participants.some(
		(participant) =>
			participant.kind === "human" && isDriveHumanId(participant.id),
	);
	const sharer = snapshot.stage.sharer;
	const spotlightParticipant = sharer
		? snapshot.participants.find(
				(participant) => participant.id === sharer.participantId,
			)
		: undefined;

	return {
		state: snapshot.driveActive && humanSeated ? "seated" : "available",
		roomId: snapshot.roomId,
		roster: [...snapshot.participants],
		spotlightOwner: sharer
			? {
					id: sharer.participantId,
					kind: sharer.kind,
					displayName:
						spotlightParticipant?.displayName ?? sharer.participantId,
				}
			: null,
		subMode: snapshot.subMode,
		cardCount: snapshot.stage.cards.length,
	};
}

export function driveRoomOpenIntent(
	state: DriveRoomPreviewState,
): DriveLaunchAction {
	switch (state) {
		case "empty":
		case "available":
			return "join";
		case "seated":
			return "focus";
		default: {
			const exhaustive: never = state;
			return exhaustive;
		}
	}
}

type DriveRoomPreviewMessage = {
	type?: unknown;
	roomId?: unknown;
	snapshot?: unknown;
	code?: unknown;
	command?: unknown;
};

function isRoomSnapshot(value: unknown): value is RoomSnapshot {
	if (!value || typeof value !== "object") {
		return false;
	}
	const snapshot = value as Partial<RoomSnapshot>;
	const stage = snapshot.stage as Partial<RoomSnapshot["stage"]> | undefined;
	return (
		typeof snapshot.roomId === "string" &&
		typeof snapshot.driveActive === "boolean" &&
		Array.isArray(snapshot.participants) &&
		typeof stage === "object" &&
		stage !== null &&
		Array.isArray(stage.cards)
	);
}

/**
 * Apply only authoritative default-room messages to the home projection.
 * Unknown messages and snapshots for another room preserve the current view.
 */
export function applyDriveRoomPreviewMessage(
	current: DriveRoomPreview,
	message: DriveRoomPreviewMessage,
	roomId = DRIVE_DEFAULT_ROOM_ID,
): DriveRoomPreview {
	if (message.type === "room_snapshot" || message.type === "drive_event") {
		if (
			!isRoomSnapshot(message.snapshot) ||
			message.snapshot.roomId !== roomId
		) {
			return current;
		}
		if (
			typeof message.roomId === "string" &&
			message.roomId !== message.snapshot.roomId
		) {
			return current;
		}
		return projectDriveRoomPreview(message.snapshot);
	}

	const roomNotFound =
		message.type === "room_not_found" ||
		(message.type === "call_error" &&
			message.code === "room_not_found" &&
			message.command === "call_get_room");
	if (!roomNotFound) {
		return current;
	}
	if (typeof message.roomId === "string" && message.roomId !== roomId) {
		return current;
	}
	return {
		...EMPTY_DRIVE_ROOM_PREVIEW,
		roomId,
	};
}
