import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyPartnerDisplayName,
	applyPartnerNameInk,
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_PARTNER,
	nameInkPaletteColor,
} from "./types";

const partner: Participant = {
	id: DRIVE_PARTICIPANT_PARTNER,
	kind: "agent",
	displayName: "Ada",
	role: "partner",
	status: "idle",
	seatSources: [],
};

describe("applyPartnerDisplayName", () => {
	it("updates partnerName and matching agent participant", () => {
		const next = applyPartnerDisplayName(
			{
				...DEFAULT_DRIVE_UI,
				partnerName: "Ada",
				participants: [partner],
			},
			"  Nova  ",
			DRIVE_PARTICIPANT_PARTNER,
		);
		expect(next.partnerName).toBe("Nova");
		expect(next.participants[0]).toMatchObject({
			id: DRIVE_PARTICIPANT_PARTNER,
			displayName: "Nova",
		});
	});

	it("does not retitle partnerName when renaming a secondary agent", () => {
		const specialist: Participant = {
			id: "drive:specialist",
			kind: "agent",
			displayName: "Scout",
			role: "specialist",
			status: "idle",
			seatSources: [],
		};
		const next = applyPartnerDisplayName(
			{
				...DEFAULT_DRIVE_UI,
				partnerName: "Ada",
				participants: [partner, specialist],
			},
			"Nova",
			"drive:specialist",
		);
		expect(next.partnerName).toBe("Ada");
		expect(next.participants[0]).toMatchObject({
			id: DRIVE_PARTICIPANT_PARTNER,
			displayName: "Ada",
		});
		expect(next.participants[1]).toMatchObject({
			id: "drive:specialist",
			displayName: "Nova",
		});
	});

	it("ignores empty names", () => {
		const state = {
			...DEFAULT_DRIVE_UI,
			partnerName: "Ada",
			participants: [partner],
		};
		expect(applyPartnerDisplayName(state, "   ")).toBe(state);
	});
});

describe("applyPartnerNameInk", () => {
	it("stores palette index 0–7 and clears with null", () => {
		const tinted = applyPartnerNameInk(DEFAULT_DRIVE_UI, 3);
		expect(tinted.partnerNameInk).toBe(3);
		expect(nameInkPaletteColor(3)).toBe("#be123c");
		expect(applyPartnerNameInk(tinted, null).partnerNameInk).toBeNull();
		expect(applyPartnerNameInk(DEFAULT_DRIVE_UI, 99)).toBe(DEFAULT_DRIVE_UI);
	});
});
