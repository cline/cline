import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DriveRoomStore, JsonlRoomEventLog, MemoryRoomEventLog } from "./index";

describe("RoomEventLog + DriveRoomStore", () => {
	let store: DriveRoomStore;

	beforeEach(() => {
		store = new DriveRoomStore();
	});

	it("owns live state on the same store (no second Map)", () => {
		store.create("r1");
		const live = store.getOrCreateLive("r1");
		expect(live.roomId).toBe("r1");
		const bumped = store.setLive({
			...live,
			spotlightParticipantId: "p1",
		});
		expect(bumped.version).toBe(1);
		expect(store.getLive("r1")?.spotlightParticipantId).toBe("p1");
	});

	it("appends to memory log before fold and supports readSince", async () => {
		const log = new MemoryRoomEventLog();
		store.attachEventLog(log);
		store.create("r1");
		const committed = store.join({
			roomId: "r1",
			participant: {
				id: "h1",
				kind: "human",
				displayName: "H",
				role: "host",
				status: "idle",
			},
		});
		expect(committed.seq).toBe(1);
		expect(store.lastSeq("r1")).toBe(1);
		const gaps = await log.readSince("r1", 0);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.event.type).toBe("control.join");
	});

	it("hydrates snapshot from jsonl log after restart", async () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-log-"));
		try {
			const log = new JsonlRoomEventLog(dir);
			store.attachEventLog(log);
			store.create("r1");
			store.join({
				roomId: "r1",
				participant: {
					id: "h1",
					kind: "human",
					displayName: "H",
					role: "host",
					status: "idle",
				},
			});
			store.mute({ roomId: "r1", participantId: "h1", muted: true });

			const restored = new DriveRoomStore();
			restored.attachEventLog(new JsonlRoomEventLog(dir));
			const snap = await restored.hydrateFromLog("r1");
			expect(snap?.participants).toHaveLength(1);
			expect(snap?.muteByParticipantId.h1).toBe(true);
			expect(restored.lastSeq("r1")).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("readSinceSync returns gaps after cursor", () => {
		const log = new MemoryRoomEventLog();
		store.attachEventLog(log);
		store.create("r1");
		store.join({
			roomId: "r1",
			participant: {
				id: "h1",
				kind: "human",
				displayName: "H",
				role: "host",
				status: "idle",
			},
		});
		store.join({
			roomId: "r1",
			participant: {
				id: "a1",
				kind: "agent",
				displayName: "A",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		const gaps = log.readSinceSync("r1", 1);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.seq).toBe(2);
	});
});
