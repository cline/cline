import { describe, expect, it } from "vitest";
import type { DriveFacetDiskSnapshot } from "@cline/shared";
import { DRIVE_FACET_CATALOG, listFacetDefs } from "./catalog";
import { createFacetStore } from "./store";

describe("DRIVE_FACET_CATALOG", () => {
	it("ships the Phase 0 durable pair plus live subMode", () => {
		expect(Object.keys(DRIVE_FACET_CATALOG).sort()).toEqual([
			"agent.appearance",
			"drive.defaults.subMode",
			"room.live.subMode",
		]);
		expect(DRIVE_FACET_CATALOG["drive.defaults.subMode"].lane).toBe(
			"durable",
		);
		expect(DRIVE_FACET_CATALOG["room.live.subMode"].conflict).toBe(
			"live_wins",
		);
	});

	it("lists defs by lane", () => {
		expect(listFacetDefs({ lane: "durable" })).toHaveLength(2);
		expect(listFacetDefs({ lane: "live" })).toHaveLength(1);
	});
});

describe("createFacetStore", () => {
	it("returns catalog defaults for an empty snapshot", () => {
		const store = createFacetStore();
		expect(store.get("drive.defaults.subMode")).toBe("plan");
		expect(store.get("agent.appearance").bodyInk).toEqual({
			kind: "token",
			token: "muted",
		});
		expect(store.get("room.live.subMode")).toBe("plan");
	});

	it("reload is idempotent and preserves live_wins values", () => {
		const store = createFacetStore();
		store.seedLiveFromDurable();
		store.setLive("room.live.subMode", "act");

		const disk: DriveFacetDiskSnapshot = {
			schemaVersion: 1,
			values: { "drive.defaults.subMode": "debug" },
			maps: {},
		};
		store.reload(disk);
		store.reload(disk);

		expect(store.get("drive.defaults.subMode")).toBe("debug");
		// Disk reload must not move the live value mid-call.
		expect(store.get("room.live.subMode")).toBe("act");
	});

	it("seeds live subMode from durable defaults once", () => {
		const store = createFacetStore({
			schemaVersion: 1,
			values: { "drive.defaults.subMode": "ask" },
			maps: {},
		});
		store.seedLiveFromDurable();
		expect(store.get("room.live.subMode")).toBe("ask");
	});

	it("reads agent.appearance from durable map by instance id", () => {
		const store = createFacetStore({
			schemaVersion: 1,
			values: {},
			maps: {
				"agent.appearance": {
					"agent.reviewer": {
						displayName: "Reviewer",
						nameInk: { kind: "palette", index: 2 },
						bodyInk: { kind: "token", token: "info" },
					},
				},
			},
		});
		expect(store.get("agent.appearance", "agent.reviewer").displayName).toBe(
			"Reviewer",
		);
		expect(store.get("agent.appearance", "missing").displayName).toBeUndefined();
	});
});
