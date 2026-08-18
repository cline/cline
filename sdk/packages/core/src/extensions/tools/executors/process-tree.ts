import { type ChildProcess, spawn } from "node:child_process";

const PROCESS_TABLE_TIMEOUT_MS = 1_000;

export interface ProcessInfo {
	pid: number;
	parentPid: number;
	processGroupId: number;
	/** Full process start time from `ps`; distinguishes reused numeric PIDs. */
	startedAt: string;
}

export interface ProcessTable {
	byPid: Map<number, ProcessInfo>;
	childrenByParent: Map<number, ProcessInfo[]>;
}

/** Parses the portable BSD/Linux `ps` columns used by monitor ownership. */
export function parseProcessTable(output: string): ProcessTable {
	const table: ProcessTable = {
		byPid: new Map(),
		childrenByParent: new Map(),
	};
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/);
		if (!match) continue;
		const pid = Number.parseInt(match[1] ?? "", 10);
		const parentPid = Number.parseInt(match[2] ?? "", 10);
		const processGroupId = Number.parseInt(match[3] ?? "", 10);
		const startedAt = (match[4] ?? "").replace(/\s+/g, " ");
		if (
			!Number.isInteger(pid) ||
			!Number.isInteger(parentPid) ||
			!Number.isInteger(processGroupId) ||
			!startedAt
		) {
			continue;
		}
		const processInfo: ProcessInfo = {
			pid,
			parentPid,
			processGroupId,
			startedAt,
		};
		table.byPid.set(pid, processInfo);
		const siblings = table.childrenByParent.get(parentPid) ?? [];
		siblings.push(processInfo);
		table.childrenByParent.set(parentPid, siblings);
	}
	return table;
}

/** Reads one bounded process-table snapshot on POSIX. */
export function readProcessTable(): Promise<ProcessTable | undefined> {
	return new Promise((resolve) => {
		let output = "";
		let finished = false;
		let watchdog: NodeJS.Timeout | undefined;
		const finish = (result?: ProcessTable) => {
			if (finished) return;
			finished = true;
			if (watchdog) clearTimeout(watchdog);
			resolve(result);
		};
		let ps: ChildProcess;
		try {
			ps = spawn("ps", ["-A", "-o", "pid=,ppid=,pgid=,lstart="], {
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			});
		} catch {
			finish();
			return;
		}
		watchdog = setTimeout(() => {
			ps.kill();
			finish();
		}, PROCESS_TABLE_TIMEOUT_MS);
		ps.stdout?.setEncoding("utf8");
		ps.stdout?.on("data", (chunk: string) => {
			output += chunk;
		});
		ps.once("error", () => finish());
		ps.once("close", (code) =>
			finish(code === 0 ? parseProcessTable(output) : undefined),
		);
	});
}

/**
 * Extends an owner's remembered PID generations from current roots and any
 * still-live descendants observed in an earlier snapshot.
 */
export interface OwnedProcessGroup {
	/** Group id, which is the pid of the leader that created it. */
	processGroupId: number;
	/**
	 * Leader's start time, recorded while the leader was verifiably ours. Absent
	 * when the leader was never observed alive.
	 */
	leaderStartedAt?: string;
}

/**
 * Decides whether a process group may still be claimed as this owner's.
 *
 * A group id is just the pid of its leader, so it carries no generation of its
 * own and cannot be trusted on its own the way a (pid, startedAt) pair can.
 * Two cases are safe:
 *
 * - **The leader is gone from the table.** A group cannot be created without a
 *   live process holding that pid, so an orphaned group can only contain
 *   descendants of the original leader.
 * - **The leader is present with the generation we recorded** while it was
 *   unambiguously ours.
 *
 * Anything else means the pid has been reused, so the group is disowned. That
 * errs toward leaking a process rather than signaling unrelated work, which is
 * the only acceptable direction for a mistake here.
 */
function isGroupStillOwned(
	group: OwnedProcessGroup,
	table: ProcessTable,
): boolean {
	const leader = table.byPid.get(group.processGroupId);
	if (!leader) return true;
	return (
		group.leaderStartedAt !== undefined &&
		leader.startedAt === group.leaderStartedAt
	);
}

export function observeOwnedProcessTree(
	ownedProcesses: Map<number, string>,
	rootPids: readonly number[],
	table: ProcessTable,
	ownedProcessGroups: readonly OwnedProcessGroup[] = [],
): void {
	const roots: number[] = [];
	for (const rootPid of rootPids) {
		if (table.byPid.has(rootPid)) roots.push(rootPid);
	}
	for (const [pid, startedAt] of ownedProcesses) {
		const current = table.byPid.get(pid);
		if (current?.startedAt === startedAt) roots.push(pid);
	}
	// Process-group membership is the one ownership marker that outlives the
	// wrapper: a monitor spawns detached, so the wrapper leads a group its
	// descendants inherit, and that still ties survivors back here once parent
	// links point at a reaped pid. It is only consulted for groups that pass
	// the reuse check above. A descendant that calls setsid() leaves the group
	// and cannot be attributed by any means available here.
	const claimableGroups = new Set(
		ownedProcessGroups
			.filter(
				(group) => group.processGroupId > 0 && isGroupStillOwned(group, table),
			)
			.map((group) => group.processGroupId),
	);
	if (claimableGroups.size > 0) {
		for (const processInfo of table.byPid.values()) {
			if (claimableGroups.has(processInfo.processGroupId)) {
				roots.push(processInfo.pid);
			}
		}
	}

	const processTree = [...new Set(roots)];
	const seen = new Set(processTree);
	for (let index = 0; index < processTree.length; index += 1) {
		const parentPid = processTree[index];
		if (parentPid === undefined) continue;
		for (const descendant of table.childrenByParent.get(parentPid) ?? []) {
			if (seen.has(descendant.pid)) continue;
			seen.add(descendant.pid);
			processTree.push(descendant.pid);
		}
	}

	for (const pid of processTree) {
		const owned = table.byPid.get(pid);
		if (owned) ownedProcesses.set(pid, owned.startedAt);
	}
}

/** Returns only PID generations that still match the current process table. */
export function getLiveOwnedProcesses(
	ownedProcesses: ReadonlyMap<number, string>,
	table: ProcessTable,
): ProcessInfo[] {
	const live: ProcessInfo[] = [];
	for (const [pid, startedAt] of ownedProcesses) {
		const current = table.byPid.get(pid);
		if (current?.startedAt === startedAt) live.push(current);
	}
	return live;
}
