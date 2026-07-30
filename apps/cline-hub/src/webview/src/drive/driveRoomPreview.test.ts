import type { RoomSnapshot } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyDriveRoomPreviewMessage,
	driveRoomOpenIntent,
	EMPTY_DRIVE_ROOM_PREVIEW,
	projectDriveRoomPreview,
} from "./driveRoomPreview";
import { DRIVE_DEFAULT_ROOM_ID } from "./types";

function roomSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return {
		schemaVersion: 1,
		roomId: DRIVE_DEFAULT_ROOM_ID,
		createdAt: "2026-07-30T12:00:00.000Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Ada",
				role: "partner",
				status: "working",
				seatSources: [],
			},
		],
		stage: {
			sharer: { kind: "agent", participantId: "drive:partner" },
			pin: null,
			cards: [
				{
					id: "card-1",
					category: "test",
					title: "Run focused tests",
					updatedAt: "2026-07-30T12:01:00.000Z",
				},
			],
		},
		addressSet: { mode: "everyone" },
		muteByParticipantId: {},
		raisedHandByParticipantId: {},
		appliedEventIds: [],
		...overrides,
	};
}

describe("projectDriveRoomPreview", () => {
	it("projects an available room with roster, spotlight, mode, and cards", () => {
		const preview = projectDriveRoomPreview(roomSnapshot());

		expect(preview.state).toBe("available");
		expect(
			preview.roster.map((participant) => participant.displayName),
		).toEqual(["Ada"]);
		expect(preview.spotlightOwner).toEqual({
			id: "drive:partner",
			kind: "agent",
			displayName: "Ada",
		});
		expect(preview.subMode).toBe("act");
		expect(preview.cardCount).toBe(1);
	});

	it("marks an active room with a human participant as seated", () => {
		const preview = projectDriveRoomPreview(
			roomSnapshot({
				participants: [
					{
						id: "drive:human",
						kind: "human",
						displayName: "You",
						role: "host",
						status: "idle",
					},
					{
						id: "drive:partner",
						kind: "agent",
						displayName: "Ada",
						role: "partner",
						status: "working",
						seatSources: [],
					},
				],
			}),
		);

		expect(preview.state).toBe("seated");
	});

	it("keeps an inactive room available even when a human seat remains", () => {
		const preview = projectDriveRoomPreview(
			roomSnapshot({
				driveActive: false,
				participants: [
					{
						id: "drive:human",
						kind: "human",
						displayName: "You",
						role: "host",
						status: "idle",
					},
				],
			}),
		);

		expect(preview.state).toBe("available");
	});
});

describe("applyDriveRoomPreviewMessage", () => {
	it.each(["room_snapshot", "drive_event"] as const)(
		"accepts an authoritative %s",
		(type) => {
			const next = applyDriveRoomPreviewMessage(EMPTY_DRIVE_ROOM_PREVIEW, {
				type,
				roomId: DRIVE_DEFAULT_ROOM_ID,
				snapshot: roomSnapshot(),
			});

			expect(next.state).toBe("available");
			expect(next.roster).toHaveLength(1);
		},
	);

	it("returns to empty when call_get_room reports room_not_found", () => {
		const current = projectDriveRoomPreview(roomSnapshot());
		const next = applyDriveRoomPreviewMessage(current, {
			type: "call_error",
			code: "room_not_found",
			command: "call_get_room",
		});

		expect(next).toEqual(EMPTY_DRIVE_ROOM_PREVIEW);
	});

	it("ignores foreign-room snapshots and unrelated errors", () => {
		const current = projectDriveRoomPreview(roomSnapshot());
		const foreign = applyDriveRoomPreviewMessage(current, {
			type: "room_snapshot",
			roomId: "another-room",
			snapshot: roomSnapshot({ roomId: "another-room" }),
		});
		const unrelatedError = applyDriveRoomPreviewMessage(current, {
			type: "call_error",
			code: "room_not_found",
			command: "call_leave",
		});

		expect(foreign).toBe(current);
		expect(unrelatedError).toBe(current);
	});

	it("ignores malformed snapshots at the webview boundary", () => {
		const current = projectDriveRoomPreview(roomSnapshot());
		const next = applyDriveRoomPreviewMessage(current, {
			type: "room_snapshot",
			roomId: DRIVE_DEFAULT_ROOM_ID,
			snapshot: {
				roomId: DRIVE_DEFAULT_ROOM_ID,
				driveActive: true,
				participants: [],
				stage: {},
			},
		});

		expect(next).toBe(current);
	});
});

describe("driveRoomOpenIntent", () => {
	it("maps empty, available, and seated states to the primary call intent", () => {
		expect(driveRoomOpenIntent("empty")).toBe("join");
		expect(driveRoomOpenIntent("available")).toBe("join");
		expect(driveRoomOpenIntent("seated")).toBe("focus");
	});
});
