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

		store.raiseHand({
			roomId: "room_1",
			participantId: "you",
			raised: true,
			at: "2026-07-25T20:00:02.500Z",
		});
		expect(store.getOrThrow("room_1").raisedHandByParticipantId.you).toBe(true);

		store.renameParticipant({
			roomId: "room_1",
			participantId: "you",
			displayName: "Ada",
			at: "2026-07-25T20:00:02.750Z",
		});
		expect(store.getOrThrow("room_1").participants[0]?.displayName).toBe("Ada");

		store.setStage({
			roomId: "room_1",
			sharer: { kind: "human", participantId: "you" },
			pin: { kind: "file", label: "router.ts" },
			at: "2026-07-25T20:00:03.000Z",
		});
		expect(store.getOrThrow("room_1").stage.sharer?.participantId).toBe("you");
		expect(store.getOrThrow("room_1").stage.pin?.kind).toBe("file");
		expect(store.getOrCreateLive("room_1").spotlightParticipantId).toBe("you");
		expect(
			store.getOrCreateLive("room_1").director.spotlightParticipantId,
		).toBe("you");

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

	it("syncLiveFromSnapshot always overwrites live spotlight from stage sharer", () => {
		const store = new DriveRoomStore();
		store.create("room_sync");
		store.join({
			roomId: "room_sync",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
		});
		store.join({
			roomId: "room_sync",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		store.setStage({
			roomId: "room_sync",
			sharer: { kind: "agent", participantId: "adam" },
		});
		expect(store.getOrCreateLive("room_sync").spotlightParticipantId).toBe(
			"adam",
		);

		// Simulate a divergent live spotlight (pre-converge / dual-write race).
		const live = store.getOrCreateLive("room_sync");
		store.setLive({
			...live,
			spotlightParticipantId: "you",
			director: { ...live.director, spotlightParticipantId: "you" },
		});
		expect(store.getOrCreateLive("room_sync").spotlightParticipantId).toBe(
			"you",
		);

		store.setStage({
			roomId: "room_sync",
			sharer: { kind: "agent", participantId: "adam" },
			pin: null,
		});
		const synced = store.getOrCreateLive("room_sync");
		expect(synced.spotlightParticipantId).toBe("adam");
		expect(synced.director.spotlightParticipantId).toBe("adam");
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

	it("recordWork upserts stage.cards from edit and command", () => {
		const store = new DriveRoomStore();
		store.create("room_work", "2026-07-26T10:00:00.000Z");
		store.recordWork({
			roomId: "room_work",
			work: {
				kind: "edit",
				path: "src/router.ts",
				summary: "route /drive",
			},
			at: "2026-07-26T10:00:01.000Z",
			eventId: "work_edit_1",
		});
		store.recordWork({
			roomId: "room_work",
			work: {
				kind: "command",
				command: "bun test",
				failed: false,
			},
			at: "2026-07-26T10:00:02.000Z",
			eventId: "work_cmd_1",
		});
		const cards = store.getOrThrow("room_work").stage.cards;
		expect(cards.map((c) => c.category).sort()).toEqual(["command", "edit"]);
		expect(cards.find((c) => c.category === "edit")?.title).toBe(
			"src/router.ts",
		);
		expect(cards.find((c) => c.category === "command")?.title).toBe("bun test");
	});

	it("links sessionId to room for the work bridge", () => {
		const store = new DriveRoomStore();
		store.create("room_link");
		store.linkSession("sess_1", "room_link");
		expect(store.getRoomIdForSession("sess_1")).toBe("room_link");
		store.unlinkSession("sess_1");
		expect(store.getRoomIdForSession("sess_1")).toBeUndefined();
	});

	it("setAddress commits control.address onto the snapshot", () => {
		const store = new DriveRoomStore();
		store.create("room_addr");
		store.setAddress({
			roomId: "room_addr",
			addressSet: { mode: "agents", agentIds: ["adam"] },
		});
		expect(store.getOrThrow("room_addr").addressSet).toEqual({
			mode: "agents",
			agentIds: ["adam"],
		});
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
