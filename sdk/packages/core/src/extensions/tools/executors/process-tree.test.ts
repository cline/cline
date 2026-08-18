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
