import { describe, expect, it } from "vitest";
import {
	parseRosterPack,
	RosterPackSchema,
} from "./rosterPack";

describe("RosterPackSchema", () => {
	it("round-trips a refs-only pack and preserves member order", () => {
		const pack = parseRosterPack({
			id: "cyber",
			slug: "cybersecurity",
			displayName: "Cybersecurity",
			members: [
				{ profileId: "reviewer", role: "specialist" },
				{
					profileId: "partner",
					role: "pair_partner",
					override: { displayName: "Pair" },
				},
			],
			addressable: true,
		});
		expect(pack.members.map((m) => m.profileId)).toEqual([
			"reviewer",
			"partner",
		]);
	});

	it("rejects prompt-shaped fields on the pack", () => {
		const parsed = RosterPackSchema.safeParse({
			id: "bad",
			slug: "bad",
			displayName: "Bad",
			members: [],
			addressable: false,
			systemPrompt: "nope",
		});
		expect(parsed.success).toBe(false);
	});
});
