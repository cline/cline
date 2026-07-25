import { describe, expect, it } from "vitest";
import type { DriveEvent } from "@cline/shared";
import {
	createEmptyRoomSnapshot,
	projectRoster,
	projectStage,
	reduceRoom,
} from "./reduceRoom";

const at = "2026-07-25T12:00:00.000Z";

describe("reduceRoom", () => {
	it("folds join/mode/stage/work idempotently", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });

		const join: DriveEvent = {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "u1",
				kind: "human",
				displayName: "Ada",
				role: "host",
				status: "idle",
			},
		};
		room = reduceRoom(room, join);
		expect(projectRoster(room)).toHaveLength(1);

		room = reduceRoom(room, join);
		expect(projectRoster(room)).toHaveLength(1);
		expect(room.appliedEventIds).toEqual(["e1"]);

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e2",
			roomId: "room_1",
			at,
			type: "control.mode",
			track: "control",
			subMode: "act",
			driveActive: true,
		});
		expect(room.subMode).toBe("act");
		expect(room.driveActive).toBe(true);

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e3",
			roomId: "room_1",
			at,
			type: "work.plan_step",
			track: "work",
			title: "Schemas",
			status: "in_progress",
		});
		expect(projectStage(room).cards[0]?.title).toBe("Schemas");
	});

	it("ignores events for other rooms", () => {
		const room = createEmptyRoomSnapshot({
			roomId: "room_1",
			createdAt: at,
		});
		const next = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "other",
			at,
			type: "control.mute",
			track: "control",
			participantId: "u1",
			muted: true,
		});
		expect(next).toBe(room);
	});
});
