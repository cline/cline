import type { StatusUpdate, TeamRuntimeState } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createFallbackStatusSnapshotSource } from "./fallback-status-snapshot-source";
import type { StatusSnapshot, StatusSnapshotSource } from "./status-snapshot-source";

function snapshot(
	overrides: Partial<StatusSnapshot> = {},
): StatusSnapshot {
	return {
		updates: [],
		summary: null,
		teams: [],
		...overrides,
	};
}

function source(
	load: StatusSnapshotSource["load"],
): StatusSnapshotSource {
	return { load };
}

const sampleUpdate = { updateId: "u1" } as StatusUpdate;
const sampleTeam = { teamId: "t1" } as TeamRuntimeState;

describe("createFallbackStatusSnapshotSource", () => {
	it("uses fallback when primary returns empty updates and teams", async () => {
		const fallbackSnap = snapshot({ updates: [sampleUpdate] });
		const primary = source(vi.fn(async () => snapshot()));
		const fallback = source(vi.fn(async () => fallbackSnap));

		const result = await createFallbackStatusSnapshotSource(
			primary,
			fallback,
		).load();

		expect(result).toBe(fallbackSnap);
		expect(primary.load).toHaveBeenCalledOnce();
		expect(fallback.load).toHaveBeenCalledOnce();
	});

	it("returns primary when it has updates or teams", async () => {
		const primarySnap = snapshot({ teams: [sampleTeam] });
		const primary = source(vi.fn(async () => primarySnap));
		const fallback = source(vi.fn(async () => snapshot()));

		const result = await createFallbackStatusSnapshotSource(
			primary,
			fallback,
		).load();

		expect(result).toBe(primarySnap);
		expect(fallback.load).not.toHaveBeenCalled();
	});

	it("uses fallback when primary throws", async () => {
		const fallbackSnap = snapshot({ updates: [sampleUpdate] });
		const primary = source(
			vi.fn(async () => {
				throw new Error("hub down");
			}),
		);
		const fallback = source(vi.fn(async () => fallbackSnap));

		const result = await createFallbackStatusSnapshotSource(
			primary,
			fallback,
		).load();

		expect(result).toBe(fallbackSnap);
	});

	it("rethrows primary error when both primary and fallback throw", async () => {
		const primaryError = new Error("primary failed");
		const primary = source(
			vi.fn(async () => {
				throw primaryError;
			}),
		);
		const fallback = source(
			vi.fn(async () => {
				throw new Error("fallback failed");
			}),
		);

		await expect(
			createFallbackStatusSnapshotSource(primary, fallback).load(),
		).rejects.toBe(primaryError);
	});
});
