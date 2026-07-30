import { describe, expect, it } from "vitest";
import {
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	applyRoomSnapshot,
	type DriveUiState,
} from "./types";
import type { RoomSnapshot } from "@cline/shared";

function sampleRoomSnapshot(
	overrides: Partial<RoomSnapshot> = {},
): RoomSnapshot {
	return {
		schemaVersion: 1,
		roomId: "default",
		createdAt: "2026-07-29T12:00:00.000Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: DRIVE_PARTICIPANT_HUMAN,
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Ada",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: DRIVE_PARTICIPANT_PARTNER,
			},
			pin: null,
			cards: [],
		},
		addressSet: { mode: "everyone" },
		muteByParticipantId: {},
		raisedHandByParticipantId: {},
		appliedEventIds: [],
		...overrides,
	};
}

describe("join auto-opens stage (slice S2)", () => {
	it("applyRoomSnapshot alone does not force stageLayout", () => {
		const next = applyRoomSnapshot(DEFAULT_DRIVE_UI, sampleRoomSnapshot());
		expect(next.active).toBe(true);
		expect(next.stageLayout).toBe(false);
	});

	it("join success path opens stageLayout when seated", () => {
		const wasPendingJoin = true;
		const seatedOnCall = true;
		const next = applyRoomSnapshot(DEFAULT_DRIVE_UI, sampleRoomSnapshot());
		const withAutoStage: DriveUiState =
			wasPendingJoin && seatedOnCall
				? { ...next, stageLayout: true }
				: next;
		expect(withAutoStage.stageLayout).toBe(true);
		expect(withAutoStage.active).toBe(true);
	});
});
