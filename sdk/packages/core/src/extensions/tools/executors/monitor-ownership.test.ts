import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	captureSpawnedProcessAnchor,
	MonitorProcessOwnership,
	type SpawnedProcessAnchor,
} from "./monitor-ownership";
import type { ProcessInfo, ProcessTable } from "./process-tree";

function buildTable(rows: readonly ProcessInfo[]): ProcessTable {
	const table: ProcessTable = {
		byPid: new Map(),
		childrenByParent: new Map(),
	};
	for (const row of rows) {
		table.byPid.set(row.pid, row);
		const siblings = table.childrenByParent.get(row.parentPid) ?? [];
		siblings.push(row);
		table.childrenByParent.set(row.parentPid, siblings);
	}
	return table;
}

/**
 * A direct child whose JS-side exit fields still read null — exactly the
 * state a `ChildProcess` is in during the window between the OS releasing
 * the pid (reap inside libuv) and the JS `exit` handler updating the fields.
 */
function staleNullExitChild(pid: number): ChildProcess & {
	kill: ReturnType<typeof vi.fn>;
} {
	return {
		pid,
		exitCode: null,
		signalCode: null,
		kill: vi.fn(),
	} as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

const SPAWN_ANCHOR: SpawnedProcessAnchor = {
	pid: 100,
	startedAt: "boot-ticks:1000",
	processGroupId: 100,
};

/** The generation actually spawned: same pid/start/group as the anchor. */
const spawnedShell: ProcessInfo = {
	pid: 100,
	parentPid: process.pid,
	processGroupId: 100,
	startedAt: "boot-ticks:1000",
	command: "bash",
};

/**
 * A foreign process that took over pid 100 after the spawned shell exited
 * and was reaped. Same numeric pid, different generation (start time), plus
 * a descendant of its own.
 */
const recycledOccupant: ProcessInfo = {
	pid: 100,
	parentPid: 1,
	processGroupId: 100,
	startedAt: "boot-ticks:9999",
	command: "unrelated-daemon",
};
const recycledOccupantChild: ProcessInfo = {
	pid: 101,
	parentPid: 100,
	processGroupId: 100,
	startedAt: "boot-ticks:10005",
	command: "unrelated-worker",
};

describe("MonitorProcessOwnership", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("regression: a recycled pid observed behind stale null exit fields is never adopted or signaled", () => {
		const ownership = new MonitorProcessOwnership(SPAWN_ANCHOR, 100);
		// The JS child object has not yet learned about the exit: both fields
		// still read null, which the pre-fix code took as proof that pid 100
		// still named the spawned shell.
		const child = staleNullExitChild(100);
		const table = buildTable([recycledOccupant, recycledOccupantChild]);

		ownership.observe(table, { pid: 100, running: true });

		// Neither the occupant nor its descendant became monitor-owned.
		expect(ownership.liveProcesses(table)).toEqual([]);

		// And termination signals nothing by pid or group: the only kill that
		// may fire is the direct child's own Node handle, which pid reuse
		// cannot redirect.
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		ownership.signal(child, ownership.liveProcesses(table), "SIGKILL");
		expect(kill).not.toHaveBeenCalled();
	});

	it("adopts the spawned generation and its descendants when the anchor matches", () => {
		const ownership = new MonitorProcessOwnership(SPAWN_ANCHOR, 100);
		const descendant: ProcessInfo = {
			pid: 101,
			parentPid: 100,
			processGroupId: 100,
			startedAt: "boot-ticks:1010",
			command: "tail",
		};
		const table = buildTable([spawnedShell, descendant]);

		ownership.observe(table, { pid: 100, running: true });

		expect(
			ownership
				.liveProcesses(table)
				.map((info) => info.pid)
				.sort(),
		).toEqual([100, 101]);
	});

	it("keeps tracking the spawned child across an exec that rewrites its command", () => {
		// `sh -c` execs a sole simple command in place of the shell: same pid,
		// start time, and process group, new command line. The anchor excludes
		// the command precisely so this remains provably the same process.
		const ownership = new MonitorProcessOwnership(SPAWN_ANCHOR, 100);
		const execdShell: ProcessInfo = { ...spawnedShell, command: "node app.js" };
		const table = buildTable([execdShell]);

		ownership.observe(table, { pid: 100, running: true });

		expect(ownership.liveProcesses(table).map((info) => info.pid)).toEqual([
			100,
		]);
	});

	it("never bootstraps ownership when no spawn anchor could be captured", () => {
		const ownership = new MonitorProcessOwnership(undefined, 100);
		const table = buildTable([spawnedShell]);

		// Even a perfectly plausible row at the child's pid is refused: without
		// a pinned generation there is no way to distinguish it from reuse.
		ownership.observe(table, { pid: 100, running: true });

		expect(ownership.liveProcesses(table)).toEqual([]);
	});

	it("does not blanket-signal the child's process group without a proven leader", () => {
		const ownership = new MonitorProcessOwnership(SPAWN_ANCHOR, 100);
		const child = staleNullExitChild(100);
		// No table row validated anything, so the group id — a reusable
		// number — must not be signaled on the strength of null JS fields.
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		ownership.signal(child, [], "SIGTERM");
		expect(kill).not.toHaveBeenCalled();
		// The direct child is still signaled through its own handle.
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("recorded descendants keep their own generations after the recorded root is recycled", () => {
		const ownership = new MonitorProcessOwnership(SPAWN_ANCHOR, 100);
		const descendant: ProcessInfo = {
			pid: 101,
			parentPid: 100,
			processGroupId: 100,
			startedAt: "boot-ticks:1010",
			command: "tail",
		};
		ownership.observe(buildTable([spawnedShell, descendant]), {
			pid: 100,
			running: true,
		});

		// The shell exits; pid 100 is recycled by foreign work, while the
		// descendant (reparented to init) lives on.
		const orphaned: ProcessInfo = { ...descendant, parentPid: 1 };
		const laterTable = buildTable([
			recycledOccupant,
			recycledOccupantChild,
			orphaned,
		]);
		ownership.observe(laterTable, { pid: 100, running: true });

		// Only the descendant recorded while provably owned remains claimable;
		// the recycled root and its children are not enrolled.
		expect(ownership.liveProcesses(laterTable).map((info) => info.pid)).toEqual(
			[101],
		);
	});

	describe("windows lazy anchor pinning", () => {
		const platform = Object.getOwnPropertyDescriptor(process, "platform");

		function onWindows<T>(run: () => T): T {
			Object.defineProperty(process, "platform", { value: "win32" });
			try {
				return run();
			} finally {
				if (platform) Object.defineProperty(process, "platform", platform);
			}
		}

		const windowsChildRow: ProcessInfo = {
			pid: 200,
			parentPid: process.pid,
			processGroupId: 0,
			startedAt: "filetime:133700000000000000",
			startedAtOrder: 133700000000000000,
			command: "powershell.exe",
		};

		it("pins from the first row observed while the exit fields are null, then refuses a recycled generation", () => {
			onWindows(() => {
				const ownership = new MonitorProcessOwnership(undefined);
				ownership.observe(buildTable([windowsChildRow]), {
					pid: 200,
					running: true,
				});
				expect(
					ownership
						.liveProcesses(buildTable([windowsChildRow]))
						.map((info) => info.pid),
				).toEqual([200]);

				// The pid is later recycled: same number, new creation FileTime.
				const recycled: ProcessInfo = {
					...windowsChildRow,
					startedAt: "filetime:133799999999990000",
					startedAtOrder: 133799999999990000,
					command: "victim.exe",
				};
				const laterTable = buildTable([recycled]);
				ownership.observe(laterTable, { pid: 200, running: true });
				expect(ownership.liveProcesses(laterTable)).toEqual([]);
			});
		});

		it("does not pin once the child is no longer verifiably alive", () => {
			onWindows(() => {
				const ownership = new MonitorProcessOwnership(undefined);
				// With the exit fields set, the process handle may already be
				// closed and the pid released, so the row proves nothing.
				const table = buildTable([windowsChildRow]);
				ownership.observe(table, { pid: 200, running: false });
				expect(ownership.liveProcesses(table)).toEqual([]);
			});
		});
	});

	describe("captureSpawnedProcessAnchor", () => {
		it.skipIf(process.platform === "win32")(
			"captures a live process's identity",
			() => {
				// The current process is guaranteed alive and un-reaped, which is
				// the same guarantee the same-tick spawn call site has.
				const anchor = captureSpawnedProcessAnchor(process.pid);
				expect(anchor).toBeDefined();
				expect(anchor?.pid).toBe(process.pid);
				expect(anchor?.startedAt).not.toBe("");
				expect(anchor?.processGroupId).toBeGreaterThanOrEqual(0);
			},
		);

		it("returns undefined for an unusable pid", () => {
			expect(captureSpawnedProcessAnchor(undefined)).toBeUndefined();
		});
	});
});
