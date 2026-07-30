import { describe, expect, it } from "vitest";
import type { Participant } from "@cline/shared";
import {
	seatedCardsFromParticipants,
	suggestRouteForUtterance,
} from "./routeSuggest";
import { DRIVE_PARTICIPANT_PARTNER } from "./types";

const partner: Participant = {
	id: DRIVE_PARTICIPANT_PARTNER,
	kind: "agent",
	displayName: "Adam",
	role: "partner",
	status: "idle",
	seatSources: [],
};

const specialist: Participant = {
	id: "drive:test",
	kind: "agent",
	displayName: "Test",
	role: "specialist",
	status: "idle",
	seatSources: [],
};

describe("suggestRouteForUtterance", () => {
	it("maps partners to pair_partner cards", () => {
		expect(seatedCardsFromParticipants([partner])[0]?.role).toBe(
			"pair_partner",
		);
	});

	it("suggests a specialist when the utterance matches labels", () => {
		const result = suggestRouteForUtterance({
			utterance: "please run the Test suite",
			participants: [partner, specialist],
			mode: "suggest",
		});
		expect(result.suggestion?.participantId).toBe("drive:test");
		expect(result.autoAddressSet).toBeNull();
	});

	it("auto-applies address when mode is auto and confidence is high", () => {
		const result = suggestRouteForUtterance({
			utterance: "Test flake please",
			participants: [partner, specialist],
			mode: "auto",
		});
		expect(result.suggestion).toBeNull();
		expect(result.autoAddressSet).toEqual({
			mode: "agents",
			agentIds: ["drive:test"],
		});
	});

	it("is a no-op in manual mode", () => {
		const result = suggestRouteForUtterance({
			utterance: "Test",
			participants: [partner, specialist],
			mode: "manual",
		});
		expect(result.suggestion).toBeNull();
		expect(result.autoAddressSet).toBeNull();
	});
});
