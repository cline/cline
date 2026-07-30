import { describe, expect, it } from "vitest";
import { createEmptyRoomSnapshot, reduceRoom } from "@cline/drive";
import type { DriveEvent, RoomSnapshot } from "@cline/shared";
import { foldIncomingDriveEvent } from "./foldRoomSnapshot";

const at = "2026-07-25T18:00:00.000Z";

function joinEvent(id: string, roomId = "room_1"): DriveEvent {
	return {
		schemaVersion: 1,
		id,
		roomId,
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
}

function modeEvent(id: string, roomId = "room_1"): DriveEvent {
	return {
		schemaVersion: 1,
		id,
		roomId,
		at,
		type: "control.mode",
		track: "control",
		subMode: "act",
		driveActive: true,
	};
}

describe("foldIncomingDriveEvent", () => {
	it("folds onto local state with the same result as reduceRoom", () => {
		let local = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		const join = joinEvent("e1");
		local = reduceRoom(local, join);

		const hub = reduceRoom(local, modeEvent("e2"));
		const folded = foldIncomingDriveEvent({
			local,
			event: modeEvent("e2"),
			hubSnapshot: hub,
		});

		expect(folded.driveActive).toBe(true);
		expect(folded.subMode).toBe("act");
		expect(folded.appliedEventIds).toEqual(["e1", "e2"]);
		expect(folded.participants).toHaveLength(1);
	});

	it("bootstraps from hub snapshot when local is null", () => {
		const hub = reduceRoom(
			createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at }),
			joinEvent("e1"),
		);
		const folded = foldIncomingDriveEvent({
			local: null,
			event: joinEvent("e1"),
			hubSnapshot: hub,
		});
		expect(folded).toEqual(hub);
		expect(folded.appliedEventIds).toEqual(["e1"]);
	});

	it("reconciles to hub when local missed intermediate events", () => {
		const empty = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		const afterJoin = reduceRoom(empty, joinEvent("e1"));
		const hub: RoomSnapshot = reduceRoom(afterJoin, modeEvent("e2"));

		// Local never saw e1; folding only e2 would no-op on empty (wrong room seq).
		const folded = foldIncomingDriveEvent({
			local: empty,
			event: modeEvent("e2"),
			hubSnapshot: hub,
		});

		expect(folded.appliedEventIds).toEqual(["e1", "e2"]);
		expect(folded.participants).toHaveLength(1);
		expect(folded.driveActive).toBe(true);
	});

	it("falls back to hub snapshot on invalid event payload", () => {
		const hub = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		const folded = foldIncomingDriveEvent({
			local: null,
			event: { not: "an-event" },
			hubSnapshot: hub,
		});
		expect(folded).toBe(hub);
	});
});
