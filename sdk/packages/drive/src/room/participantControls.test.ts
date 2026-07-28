import { describe, expect, it } from "vitest";
import {
	setParticipantDeafened,
	setParticipantMuted,
	setSpotlight,
} from "./participantControls.js";

describe("participantControls", () => {
	it("sets spotlight only for seated participants", () => {
		expect(
			setSpotlight({
				participantId: "a1",
				seatedIds: new Set(["a1", "a2"]),
			}),
		).toEqual({ ok: true, spotlightParticipantId: "a1" });
		expect(
			setSpotlight({
				participantId: "missing",
				seatedIds: new Set(["a1"]),
			}).ok,
		).toBe(false);
	});

	it("toggles mute and deafen independently", () => {
		let flags = setParticipantMuted([], "a1", true);
		expect(flags[0]).toEqual({
			participantId: "a1",
			muted: true,
			deafened: false,
		});
		flags = setParticipantDeafened(flags, "a1", true);
		expect(flags[0]?.muted).toBe(true);
		expect(flags[0]?.deafened).toBe(true);
		flags = setParticipantMuted(flags, "a1", false);
		expect(flags[0]?.muted).toBe(false);
		expect(flags[0]?.deafened).toBe(true);
	});
});
