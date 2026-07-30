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

	it("renames a seated participant displayName", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e2",
			roomId: "room_1",
			at,
			type: "control.rename",
			track: "control",
			participantId: "adam",
			displayName: "Nova",
		});
		expect(projectRoster(room)[0]?.displayName).toBe("Nova");
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

	it("prefers work.command and work.test_result summary when present", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "c1",
			roomId: "room_1",
			at,
			type: "work.command",
			track: "work",
			command: "bun test",
			failed: false,
			summary: "built ok",
		});
		expect(projectStage(room).cards[0]?.summary).toBe("built ok");

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "t1",
			roomId: "room_1",
			at,
			type: "work.test_result",
			track: "work",
			label: "unit",
			passed: true,
			summary: "3 pass",
		});
		const testCard = projectStage(room).cards.find((c) => c.category === "test");
		expect(testCard?.summary).toBe("3 pass");
	});
});
