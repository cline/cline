import { describe, expect, it } from "vitest";
import {
	getLiveOwnedProcesses,
	observeOwnedProcessTree,
	parseProcessTable,
	parseProcStat,
	parseWindowsProcessTable,
} from "./process-tree";

describe("process tree ownership", () => {
	it("tracks descendants across process groups", () => {
		const table = parseProcessTable(`
10 1 10 Mon Aug 17 18:00:00 2026 sh -c watch.sh
11 10 10 Mon Aug 17 18:00:01 2026 tail -F app.log
12 11 12 Mon Aug 17 18:00:02 2026 grep error
99 1 99 Mon Aug 17 18:00:03 2026 unrelated
`);
		const owned = new Map<number, string>();

		observeOwnedProcessTree(owned, [10], table);

		expect([...owned.keys()]).toEqual([10, 11, 12]);
		expect(getLiveOwnedProcesses(owned, table).map(({ pid }) => pid)).toEqual([
			10, 11, 12,
		]);
	});

	it("prunes generations that no longer match the live table", () => {
		// A monitor command that churns through short-lived children must not
		// accumulate every descendant that ever existed: a dead generation can
		// never match again, so it is dropped on the next observation.
		const before = parseProcessTable(
			[
				"10 1 10 Mon Aug 17 18:00:00 2026 sh -c watch.sh",
				"11 10 10 Mon Aug 17 18:00:01 2026 curl --retry 1 status",
			].join("\n"),
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [10], before);
		expect(owned.size).toBe(2);

		// The short-lived child exited; only the live generation is retained.
		const after = parseProcessTable(
			"10 1 10 Mon Aug 17 18:00:00 2026 sh -c watch.sh",
		);
		observeOwnedProcessTree(owned, [10], after);
		expect([...owned.keys()]).toEqual([10]);
	});

	it("rejects a reused PID with a different process start time", () => {
		const original = parseProcessTable(
			"42 1 42 Mon Aug 17 18:00:00 2026 tail -F app.log",
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [42], original);

		const reused = parseProcessTable(
			"42 1 42 Mon Aug 17 18:00:01 2026 tail -F app.log",
		);
		expect(getLiveOwnedProcesses(owned, reused)).toEqual([]);
	});
});

describe("ps table parsing", () => {
	it("captures the full command, including a space-padded day", () => {
		// `lstart` under LC_ALL=C pads a one-digit day with a second space, which
		// must not shift the command boundary.
		const table = parseProcessTable(
			"  7   1   7 Fri Aug  8 09:05:00 2026 node --watch server.js --port 3000",
		);
		const info = table.byPid.get(7);
		expect(info?.startedAt).toBe("Fri Aug 8 09:05:00 2026");
		expect(info?.command).toBe("node --watch server.js --port 3000");
	});

	it("drops every row of a duplicated pid", () => {
		// `ps` output is line-structured while argv is arbitrary text, so a
		// process can embed a newline and forge what parses as a row for a live
		// pid. The forgery necessarily duplicates the real row, so both are
		// poisoned: the pid is disowned (bounded leak) rather than letting a
		// forged generation be matched and signaled (stray kill).
		const table = parseProcessTable(
			[
				"  50   1  50 Mon Aug 18 10:00:00 2026 tail -F app.log",
				"  50   1  50 Mon Aug 18 10:00:00 2026 forged-duplicate",
				"  60   1  60 Mon Aug 18 10:00:01 2026 legitimate",
			].join("\n"),
		);
		expect(table.byPid.has(50)).toBe(false);
		expect(table.byPid.get(60)?.command).toBe("legitimate");
		expect(table.childrenByParent.get(1)?.map(({ pid }) => pid)).toEqual([60]);
	});
});

describe("same-second pid reuse", () => {
	it("does not accept a replacement in a different process group", () => {
		// `ps lstart` resolves only to the second, so a pid reused inside the
		// same second presents an identical start time. Start time alone would
		// accept it and teardown would signal an unrelated process.
		const original = parseProcessTable(
			"  400   300   400 Mon Aug 18 10:00:00 2026 tail -F app.log",
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [400], original);
		expect(owned.size).toBe(1);

		// Same pid, same second, different process group: a different process.
		const replacement = parseProcessTable(
			"  400   999   777 Mon Aug 18 10:00:00 2026 tail -F app.log",
		);
		expect(getLiveOwnedProcesses(owned, replacement)).toEqual([]);
	});

	it("does not accept a same-second, same-group replacement running another command", () => {
		const original = parseProcessTable(
			"  400   300   400 Mon Aug 18 10:00:00 2026 tail -F app.log",
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [400], original);

		// Same pid, same second, same group — the command is the discriminator
		// that still separates the generations on `ps` platforms.
		const replacement = parseProcessTable(
			"  400   300   400 Mon Aug 18 10:00:00 2026 make deploy",
		);
		expect(getLiveOwnedProcesses(owned, replacement)).toEqual([]);
	});

	it("still recognizes the original process across snapshots", () => {
		const table = parseProcessTable(
			"  400   300   400 Mon Aug 18 10:00:00 2026 tail -F app.log",
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [400], table);

		// Reparenting to init changes the parent pid but not the identity, which
		// is the case ownership tracking exists to follow.
		const reparented = parseProcessTable(
			"  400     1   400 Mon Aug 18 10:00:00 2026 tail -F app.log",
		);
		expect(getLiveOwnedProcesses(owned, reparented).map((p) => p.pid)).toEqual([
			400,
		]);
	});
});

describe("procfs stat parsing", () => {
	it("parses pid, parent, group, and tick-resolution start time", () => {
		const info = parseProcStat(
			"1234 (tail) S 300 400 400 34816 1234 4194304 171 0 0 0 0 0 0 0 20 0 1 0 987654321 4321 100",
		);
		expect(info).toMatchObject({
			pid: 1234,
			parentPid: 300,
			processGroupId: 400,
			startedAt: "boot-ticks:987654321",
			command: "tail",
		});
	});

	it("is not confused by a comm containing spaces, parens, or digits", () => {
		// comm is attacker-controlled (prctl PR_SET_NAME) and may contain
		// anything; fields are located from the last closing parenthesis, a
		// boundary the process cannot move.
		const info = parseProcStat(
			"77 (a) R 1 1 1 (b) S 55 66 77 0 0 0 0 0 0 0 0 0 0 0 20 0 1 0 111 0 0",
		);
		expect(info?.pid).toBe(77);
		expect(info?.command).toBe("a) R 1 1 1 (b");
		expect(info?.parentPid).toBe(55);
		expect(info?.processGroupId).toBe(66);
		expect(info?.startedAt).toBe("boot-ticks:111");
	});

	it("rejects malformed stat content", () => {
		expect(parseProcStat("")).toBeUndefined();
		expect(parseProcStat("1234 (tail) S 300")).toBeUndefined();
		expect(parseProcStat("garbage")).toBeUndefined();
	});

	it("rejects a same-second pid reuse via the tick counter", () => {
		// On Linux the start time is clock ticks since boot: a reused pid takes
		// a later tick even when both generations start within the same
		// wall-clock second, so same-second reuse cannot pass validation.
		const first = parseProcStat(
			"400 (tail) S 300 400 400 0 0 0 0 0 0 0 0 0 0 0 20 0 1 0 500000 0 0",
		);
		const second = parseProcStat(
			"400 (tail) S 300 400 400 0 0 0 0 0 0 0 0 0 0 0 20 0 1 0 500003 0 0",
		);
		if (!first || !second) throw new Error("stat fixtures failed to parse");

		const owned = new Map<number, string>();
		const table = {
			byPid: new Map([[400, first]]),
			childrenByParent: new Map(),
		};
		observeOwnedProcessTree(owned, [400], table);

		const reused = {
			byPid: new Map([[400, second]]),
			childrenByParent: new Map(),
		};
		expect(getLiveOwnedProcesses(owned, reused)).toEqual([]);
	});
});

describe("windows table parsing", () => {
	it("parses pipe-delimited rows with FileTime generations", () => {
		const table = parseWindowsProcessTable(
			[
				"1200|800|133700000000000000|cmd.exe",
				"1300|1200|133700000000500000|node.exe",
			].join("\r\n"),
		);
		expect(table.byPid.get(1200)).toMatchObject({
			pid: 1200,
			parentPid: 800,
			processGroupId: 0,
			startedAt: "filetime:133700000000000000",
			command: "cmd.exe",
		});
		expect(table.childrenByParent.get(1200)?.map(({ pid }) => pid)).toEqual([
			1300,
		]);
	});

	it("skips rows without a readable creation time", () => {
		// A process whose creation time cannot be read has no generation and can
		// never be proven owned; it must be invisible rather than claimable.
		const table = parseWindowsProcessTable(
			[
				"4||protected.exe",
				"4|0||protected.exe",
				"8|4|133700000000000000|ok.exe",
			].join("\n"),
		);
		expect(table.byPid.has(4)).toBe(false);
		expect(table.byPid.has(8)).toBe(true);
	});

	it("rejects a reused pid via the FileTime generation", () => {
		const original = parseWindowsProcessTable(
			"500|400|133700000000000000|node.exe",
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [500], original);

		// Same pid, same executable, later creation time: a different process.
		const reused = parseWindowsProcessTable(
			"500|400|133700000009999999|node.exe",
		);
		expect(getLiveOwnedProcesses(owned, reused)).toEqual([]);
	});

	it("does not adopt a child created before its claimed parent", () => {
		// Windows parent pids are historical records: the recorded parent may be
		// long dead and its pid reused by one of ours. A real child cannot
		// predate its parent, so the stale link is rejected instead of adopted
		// and signaled.
		const table = parseWindowsProcessTable(
			[
				// Our monitor child, holding a pid that once belonged to the
				// long-dead creator of the unrelated process below.
				"700|100|133700000005000000|cmd.exe",
				// Unrelated process created *before* our 700 existed.
				"900|700|133700000001000000|foreign.exe",
				// A genuine descendant, created after its parent.
				"901|700|133700000006000000|node.exe",
			].join("\n"),
		);
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [700], table);

		expect(owned.has(700)).toBe(true);
		expect(owned.has(901)).toBe(true);
		expect(owned.has(900)).toBe(false);
	});
});

describe("observeOwnedProcessTree process-group roots", () => {
	// pid ppid pgid lstart command
	const table = parseProcessTable(
		[
			"  100     1   100 Mon Aug 18 10:00:00 2026 sh -c watch.sh",
			"  101   100   100 Mon Aug 18 10:00:01 2026 tail -F app.log",
			"  102     1   100 Mon Aug 18 10:00:02 2026 grep error",
			"  200     1   200 Mon Aug 18 10:00:03 2026 unrelated",
		].join("\n"),
	);
	const leaderIdentity = "Mon Aug 18 10:00:00 2026|100|sh -c watch.sh";

	it("adopts no new group members once the leader is gone", () => {
		const owned = new Map<number, string>();
		// The leader (100) is absent. That is not proof the group is still ours:
		// after pid reuse the new holder can create a group, spawn children and
		// exit, leaving a live foreign group whose leader is also absent.
		const orphaned = parseProcessTable(
			[
				"  101     1   100 Mon Aug 18 10:00:01 2026 tail -F app.log",
				"  102     1   100 Mon Aug 18 10:00:02 2026 grep error",
			].join("\n"),
		);
		observeOwnedProcessTree(owned, [100], orphaned, [
			{ processGroupId: 100, leaderIdentity },
		]);

		expect(owned.size).toBe(0);
	});

	it("keeps members recorded while the leader lived, after it dies", () => {
		const owned = new Map<number, string>();
		// Observed once while the leader was alive and provable...
		observeOwnedProcessTree(owned, [100], table, [
			{ processGroupId: 100, leaderIdentity },
		]);
		expect([...owned.keys()].sort((a, b) => a - b)).toEqual([100, 101, 102]);

		// ...and they survive its death on their own (pid, startedAt) generation,
		// which is what teardown actually relies on.
		const afterLeaderDeath = parseProcessTable(
			[
				"  101     1   100 Mon Aug 18 10:00:01 2026 tail -F app.log",
				"  102     1   100 Mon Aug 18 10:00:02 2026 grep error",
				"  200     1   200 Mon Aug 18 10:00:03 2026 unrelated",
			].join("\n"),
		);
		observeOwnedProcessTree(owned, [], afterLeaderDeath, [
			{ processGroupId: 100, leaderIdentity },
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
			"  301     1   100 Tue Aug 19 04:00:00 2026 foreign-work",
		);
		observeOwnedProcessTree(owned, [100], reusedThenOrphaned, [
			{ processGroupId: 100, leaderIdentity },
		]);
		expect(owned.size).toBe(0);
	});

	it("claims by group while the leader still matches its recorded generation", () => {
		const owned = new Map<number, string>();
		observeOwnedProcessTree(owned, [100], table, [
			{ processGroupId: 100, leaderIdentity },
		]);
		expect([...owned.keys()].sort((a, b) => a - b)).toEqual([100, 101, 102]);
	});

	it("disowns a group whose leader pid was reused", () => {
		const owned = new Map<number, string>();
		// pid 100 is live again but started at a different time, so the group is
		// a different generation: signaling it would hit unrelated work.
		observeOwnedProcessTree(owned, [], table, [
			{
				processGroupId: 100,
				leaderIdentity: "Mon Aug 18 09:00:00 2026|100|sh -c watch.sh",
			},
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
