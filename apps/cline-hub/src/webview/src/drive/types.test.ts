import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@cline/shared";
import {
	applyBankSnapshot,
	applyRoomSnapshot,
	applySubModeIntent,
	canMutateWorkspace,
	clearPostureOverride,
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	drivePersonaSystemHint,
	fromSharedDriveSubMode,
	syncDrivePostureFromBank,
	toNativeMode,
	toSharedDriveSubMode,
	type DriveUiState,
} from "./types";

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

describe("toNativeMode", () => {
	it("maps Drive sub-modes onto plan|act", () => {
		expect(toNativeMode("plan")).toBe("plan");
		expect(toNativeMode("ask")).toBe("plan");
		expect(toNativeMode("agent")).toBe("act");
		expect(toNativeMode("debug")).toBe("act");
	});
});

describe("toSharedDriveSubMode", () => {
	it("maps agent UI mode to shared act", () => {
		expect(toSharedDriveSubMode("agent")).toBe("act");
		expect(fromSharedDriveSubMode("act")).toBe("agent");
	});
});

describe("applyRoomSnapshot", () => {
	it("projects hub room fields and clears demo authority", () => {
		const next = applyRoomSnapshot(
			{ ...DEFAULT_DRIVE_UI, demo: true, roomId: null },
			sampleRoomSnapshot({
				subMode: "ask",
				muteByParticipantId: {
					[DRIVE_PARTICIPANT_HUMAN]: true,
					[DRIVE_PARTICIPANT_PARTNER]: true,
				},
				raisedHandByParticipantId: {
					[DRIVE_PARTICIPANT_HUMAN]: true,
				},
			}),
		);
		expect(next.active).toBe(true);
		expect(next.roomId).toBe("default");
		expect(next.partnerName).toBe("Ada");
		expect(next.stageSharer).toBe("agent");
		expect(next.spotlightParticipantId).toBe(DRIVE_PARTICIPANT_PARTNER);
		expect(next.subMode).toBe("ask");
		expect(next.muted).toBe(true);
		expect(next.partnerMuted).toBe(true);
		expect(next.handRaised).toBe(true);
		expect(next.demo).toBe(false);
		expect(next.stageCards).toEqual([]);
		expect(next.stagePin).toBeNull();
		expect(next.participants).toHaveLength(2);
		expect(next.participants[0]?.kind).toBe("human");
		expect(next.participants[1]).toMatchObject({
			kind: "agent",
			displayName: "Ada",
		});
	});

	it("copies participants array without sharing the snapshot reference", () => {
		const snapshot = sampleRoomSnapshot();
		const next = applyRoomSnapshot(DEFAULT_DRIVE_UI, snapshot);
		expect(next.participants).toEqual(snapshot.participants);
		expect(next.participants).not.toBe(snapshot.participants);
	});

	it("DEFAULT_DRIVE_UI starts with empty participants and no focus", () => {
		expect(DEFAULT_DRIVE_UI.participants).toEqual([]);
		expect(DEFAULT_DRIVE_UI.focusedParticipantId).toBeNull();
		expect(DEFAULT_DRIVE_UI.addressFollowsFocusParticipantId).toBeNull();
		expect(DEFAULT_DRIVE_UI.partnerNameInk).toBeNull();
	});

	it("copies stage cards and pin from snapshot", () => {
		const cards = [
			{
				id: "card_edit_1",
				category: "edit" as const,
				title: "Chat.tsx",
				summary: "export {}",
				updatedAt: "2026-07-29T12:01:00.000Z",
			},
		];
		const pin = {
			kind: "file" as const,
			label: "Chat.tsx",
			ref: "apps/cline-hub/src/webview/src/Chat.tsx",
		};
		const next = applyRoomSnapshot(
			DEFAULT_DRIVE_UI,
			sampleRoomSnapshot({
				stage: {
					sharer: {
						kind: "human",
						participantId: DRIVE_PARTICIPANT_HUMAN,
					},
					pin,
					cards,
				},
			}),
		);
		expect(next.stageSharer).toBe("you");
		expect(next.stageCards).toEqual(cards);
		expect(next.stagePin).toEqual(pin);
		// Projection is a copy — mutating snapshot later must not leak.
		expect(next.stageCards).not.toBe(cards);
	});

	it("clears stage projection when snapshot has empty stage", () => {
		const next = applyRoomSnapshot(
			{
				...DEFAULT_DRIVE_UI,
				stageCards: [
					{
						id: "stale",
						category: "command",
						title: "ls",
						updatedAt: "2026-07-29T11:00:00.000Z",
					},
				],
				stagePin: { kind: "terminal", label: "shell" },
			},
			sampleRoomSnapshot({
				stage: { sharer: null, pin: null, cards: [] },
			}),
		);
		expect(next.stageCards).toEqual([]);
		expect(next.stagePin).toBeNull();
	});

	it("DEFAULT_DRIVE_UI starts with empty stage projection", () => {
		expect(DEFAULT_DRIVE_UI.stageCards).toEqual([]);
		expect(DEFAULT_DRIVE_UI.stagePin).toBeNull();
		expect(DEFAULT_DRIVE_UI.participants).toEqual([]);
	});

	it("maps human stage sharer to you", () => {
		const next = applyRoomSnapshot(
			DEFAULT_DRIVE_UI,
			sampleRoomSnapshot({
				stage: {
					sharer: {
						kind: "human",
						participantId: DRIVE_PARTICIPANT_HUMAN,
					},
					pin: null,
					cards: [],
				},
			}),
		);
		expect(next.stageSharer).toBe("you");
		expect(next.spotlightParticipantId).toBe(DRIVE_PARTICIPANT_HUMAN);
	});

	it("preserves mute/hand when snapshot omits those ids", () => {
		const next = applyRoomSnapshot(
			{
				...DEFAULT_DRIVE_UI,
				muted: true,
				partnerMuted: true,
				handRaised: true,
			},
			sampleRoomSnapshot({ driveActive: false }),
		);
		expect(next.active).toBe(false);
		expect(next.muted).toBe(true);
		expect(next.partnerMuted).toBe(true);
		expect(next.handRaised).toBe(true);
	});

	it("clears active when local human has left even if driveActive persists", () => {
		const next = applyRoomSnapshot(
			{ ...DEFAULT_DRIVE_UI, active: true, roomId: "default" },
			sampleRoomSnapshot({
				driveActive: true,
				participants: [
					{
						id: DRIVE_PARTICIPANT_PARTNER,
						kind: "agent",
						displayName: "Ada",
						role: "partner",
						status: "idle",
						seatSources: [],
					},
				],
			}),
		);
		expect(next.active).toBe(false);
		expect(next.roomId).toBeNull();
		expect(next.partnerName).toBe("Ada");
		expect(next.demo).toBe(false);
	});
});

describe("drivePersonaSystemHint", () => {
	it("is empty when Drive is off", () => {
		expect(drivePersonaSystemHint(DEFAULT_DRIVE_UI)).toBe("");
	});

	it("includes partner and bank guidance when Drive is on", () => {
		const hint = drivePersonaSystemHint({
			...DEFAULT_DRIVE_UI,
			active: true,
			subMode: "ask",
			postureOverride: "ask",
			partnerName: "Ada",
		});
		expect(hint).toContain("Ada");
		expect(hint).toContain("ask");
		expect(hint).toContain("plan");
		expect(hint).toContain(".drive/bank");
		expect(hint).toContain("override");
	});
});

describe("bank-derived posture", () => {
	it("derives Agent when open tasks exist", () => {
		const state = applyBankSnapshot(
			{ ...DEFAULT_DRIVE_UI, active: true },
			{
				activePlanId: "p1",
				openTaskIds: ["t1"],
				nowTaskId: "t1",
				nextTaskId: null,
				nowTitle: "One",
				nextTitle: null,
			},
		);
		expect(state.subMode).toBe("agent");
		expect(canMutateWorkspace(state)).toBe(true);
	});

	it("derives Plan when bank is empty", () => {
		const state = syncDrivePostureFromBank({
			...DEFAULT_DRIVE_UI,
			active: true,
			subMode: "agent",
		});
		expect(state.subMode).toBe("plan");
		expect(canMutateWorkspace(state)).toBe(false);
	});

	it("keeps Ask override until explicit clear", () => {
		let state: DriveUiState = {
			...DEFAULT_DRIVE_UI,
			active: true,
			bankSnapshot: {
				activePlanId: "p1",
				openTaskIds: ["t1"],
				nowTaskId: "t1",
				nextTaskId: null,
				nowTitle: "One",
				nextTitle: null,
			},
		};
		state = applySubModeIntent(state, "ask");
		expect(state.subMode).toBe("ask");
		expect(canMutateWorkspace(state)).toBe(false);
		state = applySubModeIntent(state, "agent");
		expect(state.subMode).toBe("ask");
		state = clearPostureOverride(state);
		expect(state.subMode).toBe("agent");
		expect(state.postureOverride).toBeNull();
	});
});
