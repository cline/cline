import { describe, expect, it } from "vitest";
import { joinCall } from "./join-call";
import { DriveRoomStore, resetDriveRoomStoreForTests } from "./room";

describe("DriveRoomStore", () => {
	it("joins, mutes, sets stage/mode, and leaves while persisting the room", () => {
		const store = new DriveRoomStore();
		store.create("room_1", "2026-07-25T20:00:00.000Z");

		const joined = store.join({
			roomId: "room_1",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			at: "2026-07-25T20:00:01.000Z",
		});
		expect(joined.snapshot.participants).toHaveLength(1);

		store.mute({
			roomId: "room_1",
			participantId: "you",
			muted: true,
			at: "2026-07-25T20:00:02.000Z",
		});
		expect(store.getOrThrow("room_1").muteByParticipantId.you).toBe(true);

		store.setStage({
			roomId: "room_1",
			sharer: { kind: "human", participantId: "you" },
			pin: { kind: "file", label: "router.ts" },
			at: "2026-07-25T20:00:03.000Z",
		});
		expect(store.getOrThrow("room_1").stage.sharer?.participantId).toBe("you");
		expect(store.getOrThrow("room_1").stage.pin?.kind).toBe("file");

		store.setMode({
			roomId: "room_1",
			subMode: "ask",
			driveActive: true,
			at: "2026-07-25T20:00:04.000Z",
		});
		expect(store.getOrThrow("room_1").subMode).toBe("ask");
		expect(store.getOrThrow("room_1").driveActive).toBe(true);

		store.leave({
			roomId: "room_1",
			participantId: "you",
			at: "2026-07-25T20:00:05.000Z",
		});
		const afterLeave = store.getOrThrow("room_1");
		expect(afterLeave.participants).toHaveLength(0);
		expect(afterLeave.driveActive).toBe(true);
	});

	it("is idempotent on re-join of the same participant id", () => {
		const store = new DriveRoomStore();
		const participant = {
			id: "adam",
			kind: "agent" as const,
			displayName: "Adam",
			role: "partner" as const,
			status: "idle" as const,
			seatSources: [] as string[],
		};
		store.create("room_2");
		store.join({ roomId: "room_2", participant });
		store.join({
			roomId: "room_2",
			participant: { ...participant, displayName: "Adam II" },
		});
		const snapshot = store.getOrThrow("room_2");
		expect(snapshot.participants).toHaveLength(1);
		expect(snapshot.participants[0]?.displayName).toBe("Adam II");
	});
});

describe("joinCall", () => {
	it("seats host + pair partner and activates agent stage", () => {
		resetDriveRoomStoreForTests();
		const first = joinCall({
			roomId: "call_1",
			human: { id: "you", displayName: "You" },
			agent: { id: "adam", displayName: "Adam" },
		});
		expect(first.created).toBe(true);
		expect(first.snapshot.participants.map((p) => p.id).sort()).toEqual([
			"adam",
			"you",
		]);
		expect(first.snapshot.driveActive).toBe(true);
		expect(first.snapshot.stage.sharer).toEqual({
			kind: "agent",
			participantId: "adam",
		});

		const second = joinCall({
			roomId: "call_1",
			human: { id: "you", displayName: "You" },
			agent: { id: "adam", displayName: "Adam" },
		});
		expect(second.created).toBe(false);
		expect(second.snapshot.participants).toHaveLength(2);
	});
});
