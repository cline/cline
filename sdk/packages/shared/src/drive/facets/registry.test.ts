import { describe, expect, it } from "vitest";
import {
	emptyDriveRegistry,
	lookupRosterPack,
	parseDriveRegistry,
} from "./registry";

describe("DriveRegistry", () => {
	it("round-trips a registry with one pack", () => {
		const registry = parseDriveRegistry({
			schemaVersion: 1,
			packs: {
				cyber: {
					id: "cyber",
					slug: "cybersecurity",
					displayName: "Cybersecurity",
					members: [{ profileId: "reviewer", role: "specialist" }],
					addressable: true,
				},
			},
		});
		expect(registry.packs.cyber?.slug).toBe("cybersecurity");
		expect(lookupRosterPack(registry, "cybersecurity")?.id).toBe("cyber");
		expect(lookupRosterPack(registry, "missing")).toBeNull();
	});

	it("rejects prompt-shaped keys on nested packs", () => {
		expect(() =>
			parseDriveRegistry({
				schemaVersion: 1,
				packs: {
					bad: {
						id: "bad",
						slug: "bad",
						displayName: "Bad",
						members: [],
						addressable: false,
						systemPrompt: "nope",
					},
				},
			}),
		).toThrow();
	});

	it("emptyDriveRegistry has no packs", () => {
		expect(emptyDriveRegistry().packs).toEqual({});
	});
});
