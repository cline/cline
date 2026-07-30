import { describe, expect, it } from "vitest";
import type { AgentProfile, RosterPack } from "@cline/shared";
import { capPreset, expandRosterPack } from "./expand.js";

const ink = { kind: "token" as const, token: "foreground" as const };

function profile(id: string, displayName?: string): AgentProfile {
	return {
		id,
		ref: { kind: "builtin", id },
		displayName,
		nameInk: ink,
		bodyInk: ink,
	};
}

const pack: RosterPack = {
	id: "review",
	slug: "review",
	displayName: "Review",
	members: [
		{ profileId: "a", role: "specialist" },
		{ profileId: "b", role: "specialist", override: { displayName: "Bee" } },
		{ profileId: "missing", role: "pair_partner" },
	],
	addressable: true,
};

describe("capPreset", () => {
	it("returns the minimum of parent and child", () => {
		expect(capPreset("readonly", "full")).toBe("readonly");
		expect(capPreset("full", "standard")).toBe("standard");
		expect(capPreset("standard", "standard")).toBe("standard");
	});
});

describe("expandRosterPack", () => {
	it("reports missing profiles and preserves order", () => {
		const profiles = new Map([
			["a", profile("a", "Ada")],
			["b", profile("b", "Bob")],
		]);
		const result = expandRosterPack({
			pack,
			profiles,
			parentPreset: "full",
			seatCap: 10,
		});
		expect(result.missing).toEqual(["missing"]);
		expect(result.truncated).toBe(false);
		expect(result.proposals.map((p) => p.profileId)).toEqual(["a", "b"]);
		expect(result.proposals[1]?.displayName).toBe("Bee");
		expect(result.proposals[0]?.effectivePreset).toBe("readonly");
	});

	it("truncates beyond seatCap", () => {
		const profiles = new Map([
			["a", profile("a")],
			["b", profile("b")],
		]);
		const result = expandRosterPack({
			pack,
			profiles,
			parentPreset: "full",
			seatCap: 1,
		});
		expect(result.proposals).toHaveLength(1);
		expect(result.truncated).toBe(true);
	});

	it("caps child full under readonly parent", () => {
		const profiles = new Map([["a", profile("a")]]);
		const result = expandRosterPack({
			pack: {
				...pack,
				members: [{ profileId: "a", role: "specialist" }],
			},
			profiles,
			parentPreset: "readonly",
			seatCap: 5,
			presetForProfile: () => "full",
		});
		expect(result.proposals[0]?.effectivePreset).toBe("readonly");
	});
});
