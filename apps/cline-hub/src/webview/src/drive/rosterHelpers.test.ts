import { describe, expect, it } from "vitest";
import type { Participant } from "@cline/shared";
import {
	applyTranscriptFocus,
	isRosterParticipantHandRaised,
	isRosterParticipantMuted,
	participantStatusLabel,
	resolveAgentHomeSlug,
	resolveRosterParticipants,
} from "./rosterHelpers";
import {
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";

const human: Participant = {
	id: DRIVE_PARTICIPANT_HUMAN,
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
};

const partner: Participant = {
	id: DRIVE_PARTICIPANT_PARTNER,
	kind: "agent",
	displayName: "Ada",
	role: "partner",
	status: "speaking",
	seatSources: [],
};

describe("resolveRosterParticipants", () => {
	it("returns hub participants when present", () => {
		const rows = resolveRosterParticipants({
			...DEFAULT_DRIVE_UI,
			participants: [human, partner],
		});
		expect(rows).toEqual([human, partner]);
	});

	it("synthesizes human + partner from partnerName when empty", () => {
		const rows = resolveRosterParticipants({
			...DEFAULT_DRIVE_UI,
			partnerName: "Ada",
			participants: [],
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			id: DRIVE_PARTICIPANT_HUMAN,
			kind: "human",
			displayName: "You",
		});
		expect(rows[1]).toMatchObject({
			id: DRIVE_PARTICIPANT_PARTNER,
			kind: "agent",
			displayName: "Ada",
			role: "partner",
		});
	});
});

describe("mute and hand flags", () => {
	it("maps muted / partnerMuted onto roster rows", () => {
		const drive = {
			...DEFAULT_DRIVE_UI,
			muted: true,
			partnerMuted: true,
			participants: [human, partner],
		};
		expect(isRosterParticipantMuted(drive, human)).toBe(true);
		expect(isRosterParticipantMuted(drive, partner)).toBe(true);
	});

	it("maps handRaised only onto the human", () => {
		const drive = {
			...DEFAULT_DRIVE_UI,
			handRaised: true,
			participants: [human, partner],
		};
		expect(isRosterParticipantHandRaised(drive, human)).toBe(true);
		expect(isRosterParticipantHandRaised(drive, partner)).toBe(false);
	});
});

describe("applyTranscriptFocus", () => {
	it("focuses an agent and sets address-follows-focus", () => {
		const next = applyTranscriptFocus(
			{ ...DEFAULT_DRIVE_UI, participants: [human, partner] },
			DRIVE_PARTICIPANT_PARTNER,
		);
		expect(next.focusedParticipantId).toBe(DRIVE_PARTICIPANT_PARTNER);
		expect(next.addressFollowsFocusParticipantId).toBe(
			DRIVE_PARTICIPANT_PARTNER,
		);
	});

	it("focuses self and clears address-follows-focus to everyone", () => {
		const next = applyTranscriptFocus(
			{
				...DEFAULT_DRIVE_UI,
				participants: [human, partner],
				focusedParticipantId: DRIVE_PARTICIPANT_PARTNER,
				addressFollowsFocusParticipantId: DRIVE_PARTICIPANT_PARTNER,
			},
			DRIVE_PARTICIPANT_HUMAN,
		);
		expect(next.focusedParticipantId).toBe(DRIVE_PARTICIPANT_HUMAN);
		expect(next.addressFollowsFocusParticipantId).toBeNull();
	});
});

describe("resolveAgentHomeSlug", () => {
	it("maps default partner / adam to pair-partner", () => {
		expect(resolveAgentHomeSlug(partner)).toBe("pair-partner");
		expect(
			resolveAgentHomeSlug({
				...partner,
				id: "adam",
			}),
		).toBe("pair-partner");
	});

	it("prefers seatSources slug when present", () => {
		expect(
			resolveAgentHomeSlug({
				...partner,
				seatSources: [{ kind: "pack", packId: "custom-agent" }],
			}),
		).toBe("custom-agent");
	});

	it("returns null for humans", () => {
		expect(
			resolveAgentHomeSlug({
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			}),
		).toBeNull();
	});
});

describe("participantStatusLabel", () => {
	it("maps working to thinking for presence copy", () => {
		expect(participantStatusLabel("idle")).toBe("idle");
		expect(participantStatusLabel("working")).toBe("thinking");
		expect(participantStatusLabel("speaking")).toBe("speaking");
		expect(participantStatusLabel("away")).toBe("away");
	});
});
