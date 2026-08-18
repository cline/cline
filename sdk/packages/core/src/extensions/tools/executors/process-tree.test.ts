import { describe, expect, it } from "vitest";
import {
	getLiveOwnedProcesses,
	observeOwnedProcessTree,
	parseProcessTable,
} from "./process-tree";

describe("process tree ownership", () => {
	it("tracks descendants across process groups", () => {
		const table = parseProcessTable(`
10 1 10 Mon Aug 17 18:00:00 2026
11 10 10 Mon Aug 17 18:00:01 2026
12 11 12 Mon Aug 17 18:00:02 2026
99 1 99 Mon Aug 17 18:00:03 2026
`);
		const owned = new Map<number, string>();

		observeOwnedProcessTree(owned, [10], table);

		expect([...owned.keys()]).toEqual([10, 11, 12]);
		expect(getLiveOwnedProcesses(owned, table).map(({ pid }) => pid)).toEqual([
			10, 11, 12,
		]);
	});

	it("rejects a reused PID with a different process start time", () => {
		const original = parseProcessTable("42 1 42 Mon Aug 17 18:00:00 2026");
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [42], original);

		const reused = parseProcessTable("42 1 42 Mon Aug 17 18:00:01 2026");
		expect(getLiveOwnedProcesses(owned, reused)).toEqual([]);
	});
});

describe("observeOwnedProcessTree process-group roots", () => {
	// pid ppid pgid lstart
	const table = parseProcessTable(
		[
			"  100     1   100 Mon Aug 18 10:00:00 2026",
			"  101   100   100 Mon Aug 18 10:00:01 2026",
			"  102     1   100 Mon Aug 18 10:00:02 2026",
			"  200     1   200 Mon Aug 18 10:00:03 2026",
		].join("\n"),
	);

	it("adopts no new group members once the leader is gone", () => {
		const owned = new Map<number, string>();
		// The leader (100) is absent. That is not proof the group is still ours:
		// after pid reuse the new holder can create a group, spawn children and
		// exit, leaving a live foreign group whose leader is also absent.
		const orphaned = parseProcessTable(
			[
				"  101     1   100 Mon Aug 18 10:00:01 2026",
				"  102     1   100 Mon Aug 18 10:00:02 2026",
			].join("\n"),
		);
		observeOwnedProcessTree(owned, [100], orphaned, [
			{ processGroupId: 100, leaderStartedAt: "Mon Aug 18 10:00:00 2026" },
		]);

		expect(owned.size).toBe(0);
	});

	it("keeps members recorded while the leader lived, after it dies", () => {
		const owned = new Map<number, string>();
		// Observed once while the leader was alive and provable...
		observeOwnedProcessTree(owned, [100], table, [
			{ processGroupId: 100, leaderStartedAt: "Mon Aug 18 10:00:00 2026" },
		]);
		expect([...owned.keys()].sort((a, b) => a - b)).toEqual([100, 101, 102]);

		// ...and they survive its death on their own (pid, startedAt) generation,
		// which is what teardown actually relies on.
		const afterLeaderDeath = parseProcessTable(
			[
				"  101     1   100 Mon Aug 18 10:00:01 2026",
				"  102     1   100 Mon Aug 18 10:00:02 2026",
				"  200     1   200 Mon Aug 18 10:00:03 2026",
			].join("\n"),
		);
		observeOwnedProcessTree(owned, [], afterLeaderDeath, [
			{ processGroupId: 100, leaderStartedAt: "Mon Aug 18 10:00:00 2026" },
		]);
		expect(owned.has(101)).toBe(true);
		expect(owned.has(102)).toBe(true);
		// An unrelated process in its own group is never claimed.
		expect(owned.has(200)).toBe(false);
	});

	it("disowns a group whose leader vanished and left foreign children", () => {
		const owned = new Map<number, string>();
		// The exact sequence the absent-leader shortcut used to miss: pid 100 was
		// reused by a group leader that spawned 301 and then exited, so group 100
		// is live and foreign while its own leader is absent.
		const reusedThenOrphaned = parseProcessTable(
			"  301     1   100 Tue Aug 19 04:00:00 2026",
		);
		observeOwnedProcessTree(owned, [100], reusedThenOrphaned, [
			{ processGroupId: 100, leaderStartedAt: "Mon Aug 18 10:00:00 2026" },
		]);
		expect(owned.size).toBe(0);
	});

	it("claims by group while the leader still matches its recorded generation", () => {
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [100], table, [
			{ processGroupId: 100, leaderStartedAt: "Mon Aug 18 10:00:00 2026" },
		]);
		expect([...owned.keys()].sort((a, b) => a - b)).toEqual([100, 101, 102]);
	});

	it("disowns a group whose leader pid was reused", () => {
		const owned = new Map<number, string>();
		// pid 100 is live again but started at a different time, so the group is
		// a different generation: signaling it would hit unrelated work.
		observeOwnedProcessTree(owned, [], table, [
			{ processGroupId: 100, leaderStartedAt: "Mon Aug 18 09:00:00 2026" },
		]);
		expect(owned.size).toBe(0);
	});

	it("disowns a live group it never observed as leader", () => {
		const owned = new Map<number, string>();
		// No recorded generation and a live pid 100 — unprovable, so refuse
		// rather than risk signaling someone else's process group.
		observeOwnedProcessTree(owned, [], table, [{ processGroupId: 100 }]);
		expect(owned.size).toBe(0);
	});

	it("claims nothing by group when no group is owned", () => {
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [999], table);
		expect(owned.size).toBe(0);
	});

	it("ignores a zero group id", () => {
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [], table, [{ processGroupId: 0 }]);
		expect(owned.size).toBe(0);
	});
});
