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

	it("claims survivors by group once the wrapper is gone", () => {
		const owned = new Map<number, string>();
		// The wrapper (100) already exited and was reaped, so it is offered as a
		// root but is absent from the table; only the group still ties 101 and
		// the reparented 102 back to this monitor.
		observeOwnedProcessTree(owned, [100], table, [100]);

		expect([...owned.keys()].sort((a, b) => a - b)).toEqual([100, 101, 102]);
		// An unrelated process in its own group is never claimed.
		expect(owned.has(200)).toBe(false);
	});

	it("claims nothing by group when no group is owned", () => {
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [999], table);
		expect(owned.size).toBe(0);
	});

	it("ignores a zero group id", () => {
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [], table, [0]);
		expect(owned.size).toBe(0);
	});
});
