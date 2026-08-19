import { type ChildProcess, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

const PROCESS_TABLE_TIMEOUT_MS = 1_000;

export interface ProcessInfo {
	pid: number;
	parentPid: number;
	processGroupId: number;
	/**
	 * Platform-specific start-time token. On Linux this is the kernel's
	 * `starttime` from `/proc/<pid>/stat` — clock ticks since boot, so it is
	 * monotonic for the life of the boot and resolves to ~10ms. Elsewhere it is
	 * the whole-second `ps lstart` string.
	 */
	startedAt: string;
	/** Command line (or kernel `comm` on Linux), an extra identity discriminator. */
	command: string;
}

/**
 * Identity used to tell one generation of a numeric pid from the next.
 *
 * Three components, because no single one is trustworthy everywhere:
 *
 * - Start time. On Linux it comes from `/proc/<pid>/stat` in clock ticks since
 *   boot, so two holders of the same pid can only present the same value if the
 *   pid space wrapped around within one tick (~10ms) — not reachable in
 *   practice. On macOS/BSD, portable `ps` resolves only to the second, so the
 *   other two components carry the discrimination there.
 * - Process group id. Stable for a process's lifetime, unlike the parent pid,
 *   which changes on reparenting — precisely the case ownership tracking
 *   exists to follow.
 * - Command. A same-second, same-group replacement would additionally have to
 *   run the identical command line to be misidentified.
 *
 * Every mismatch disowns rather than misidentifies: a process that changes
 * groups or rewrites its argv is left running (a bounded leak), never signaled
 * as someone else (an unbounded stray kill). Residual on the `ps` platforms: a
 * same-pid, same-second, same-group, identical-command collision is still
 * conceivable. Closing that needs kernel-maintained ownership (cgroups, job
 * objects, pidfd), which no portable primitive exposes here.
 */
export function processIdentity(info: ProcessInfo): string {
	return `${info.startedAt}|${info.processGroupId}|${info.command}`;
}

export interface ProcessTable {
	byPid: Map<number, ProcessInfo>;
	childrenByParent: Map<number, ProcessInfo[]>;
}

function buildProcessTable(rows: readonly ProcessInfo[]): ProcessTable {
	const table: ProcessTable = {
		byPid: new Map(),
		childrenByParent: new Map(),
	};
	for (const processInfo of rows) {
		table.byPid.set(processInfo.pid, processInfo);
		const siblings = table.childrenByParent.get(processInfo.parentPid) ?? [];
		siblings.push(processInfo);
		table.childrenByParent.set(processInfo.parentPid, siblings);
	}
	return table;
}

/**
 * Parses the BSD `ps` columns used by monitor ownership on non-Linux POSIX.
 *
 * `ps` output is line-structured while the command column is arbitrary
 * attacker-influenced text, so a process whose argv contains a newline can
 * forge what parses as an additional row for any pid it likes. A forged row
 * for a *live* pid necessarily duplicates the real row `ps` also prints, so
 * duplicate pids are treated as poisoned and dropped entirely — disowning the
 * pid (a bounded leak) instead of letting the forged generation be signaled.
 * A forged row for a pid that is dead at read time can at worst aim a signal
 * at that dead pid; landing it on real work would additionally require a
 * targeted pid reuse inside the read-to-signal window, the same TOCTOU any
 * table-based teardown has.
 */
export function parseProcessTable(output: string): ProcessTable {
	const rows = new Map<number, ProcessInfo>();
	const poisoned = new Set<number>();
	for (const line of output.split(/\r?\n/)) {
		// pid, ppid, pgid, then `lstart` — exactly five tokens under LC_ALL=C
		// ("Mon Aug 18 22:13:04 2026") — then the command as the rest of the line.
		const match = line.match(
			/^\s*(\d+)\s+(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+?)\s*$/,
		);
		if (!match) continue;
		const pid = Number.parseInt(match[1] ?? "", 10);
		const parentPid = Number.parseInt(match[2] ?? "", 10);
		const processGroupId = Number.parseInt(match[3] ?? "", 10);
		const startedAt = (match[4] ?? "").replace(/\s+/g, " ");
		const command = match[5] ?? "";
		if (
			!Number.isInteger(pid) ||
			!Number.isInteger(parentPid) ||
			!Number.isInteger(processGroupId) ||
			!startedAt ||
			!command
		) {
			continue;
		}
		if (rows.has(pid)) {
			poisoned.add(pid);
			continue;
		}
		rows.set(pid, { pid, parentPid, processGroupId, startedAt, command });
	}
	for (const pid of poisoned) rows.delete(pid);
	return buildProcessTable([...rows.values()]);
}

/**
 * Parses one `/proc/<pid>/stat` line.
 *
 * The second field, `comm`, is parenthesized and may itself contain spaces,
 * parentheses, or digits, so fields are located from the *last* closing
 * parenthesis — the kernel writes everything after it as space-separated
 * numerics, and nothing a process controls can move that boundary. Field 22
 * (`starttime`, clock ticks since boot) is kept as the start-time token.
 */
export function parseProcStat(content: string): ProcessInfo | undefined {
	const open = content.indexOf("(");
	const close = content.lastIndexOf(")");
	if (open < 0 || close < open) return undefined;
	const pid = Number.parseInt(content.slice(0, open).trim(), 10);
	const command = content.slice(open + 1, close);
	const fields = content
		.slice(close + 1)
		.trim()
		.split(/\s+/);
	// fields[0] is field 3 (state), so overall field N sits at fields[N - 3].
	const parentPid = Number.parseInt(fields[1] ?? "", 10);
	const processGroupId = Number.parseInt(fields[2] ?? "", 10);
	const startTicks = fields[19] ?? "";
	if (
		!Number.isInteger(pid) ||
		!Number.isInteger(parentPid) ||
		!Number.isInteger(processGroupId) ||
		!/^\d+$/.test(startTicks)
	) {
		return undefined;
	}
	return {
		pid,
		parentPid,
		processGroupId,
		startedAt: `boot-ticks:${startTicks}`,
		command,
	};
}

/**
 * Reads the process table from `/proc` directly.
 *
 * Preferred over `ps` wherever procfs exists: the kernel-maintained
 * `starttime` tick counter gives generation resolution that second-granular
 * `lstart` cannot, and per-pid virtual files cannot be forged by argv content
 * the way line-structured `ps` output can. Processes that exit between the
 * directory listing and the read are simply skipped.
 */
async function readProcProcessTable(): Promise<ProcessTable | undefined> {
	let names: string[];
	try {
		names = await readdir("/proc");
	} catch {
		return undefined;
	}
	const rows: ProcessInfo[] = [];
	await Promise.all(
		names
			.filter((name) => /^\d+$/.test(name))
			.map(async (name) => {
				try {
					const stat = await readFile(`/proc/${name}/stat`, "utf8");
					const info = parseProcStat(stat);
					if (info) rows.push(info);
				} catch {
					// The process exited between readdir and read.
				}
			}),
	);
	if (rows.length === 0) return undefined;
	return buildProcessTable(rows);
}

/** Reads one bounded `ps` snapshot on POSIX platforms without procfs. */
function readPsProcessTable(): Promise<ProcessTable | undefined> {
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
			// LC_ALL=C pins `lstart` to the asctime layout the parser expects; in
			// other locales its token count varies. `-ww` prevents column-width
			// truncation of the command, which would make identities compare
			// unequal between snapshots and disown live descendants.
			ps = spawn(
				"ps",
				["-A", "-ww", "-o", "pid=,ppid=,pgid=,lstart=,command="],
				{
					stdio: ["ignore", "pipe", "ignore"],
					windowsHide: true,
					env: { ...process.env, LC_ALL: "C" },
				},
			);
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

/** Reads one bounded process-table snapshot on POSIX. */
export function readProcessTable(): Promise<ProcessTable | undefined> {
	if (process.platform === "linux") return readProcProcessTable();
	return readPsProcessTable();
}

/**
 * Extends an owner's remembered PID generations from current roots and any
 * still-live descendants observed in an earlier snapshot.
 */
export interface OwnedProcessGroup {
	/** Group id, which is the pid of the leader that created it. */
	processGroupId: number;
	/**
	 * Leader's {@link processIdentity}, recorded while it was verifiably ours.
	 * Absent when the leader was never observed alive.
	 */
	leaderIdentity?: string;
}

/**
 * Decides whether a process group may still be claimed as this owner's.
 *
 * A group id is just the pid of its leader, so it carries no generation of its
 * own and cannot be trusted the way a (pid, startedAt) pair can. Ownership is
 * therefore asserted only from positive evidence: the leader is present in the
 * table with exactly the generation recorded while it was unambiguously ours.
 *
 * An absent leader is deliberately *not* treated as proof. It is tempting to
 * argue that a group cannot be recreated without a live process holding that
 * pid, so an orphaned group must contain only the original descendants — but
 * that misses a sequence: after pid reuse, the new holder can create a group,
 * spawn children, and exit. The group id is then live and foreign while its
 * leader is once again absent, and signaling it would reach unrelated work.
 *
 * Consequence: once the leader is gone, no *new* group members are adopted.
 * Members recorded while it was alive keep their own (pid, startedAt)
 * generation and survive its death independently, which is what teardown
 * actually relies on. A descendant that appears only after the leader is gone —
 * or one that calls setsid() and leaves the group — cannot be attributed by any
 * means available here, and is left running rather than risking a stray kill.
 */
function isGroupStillOwned(
	group: OwnedProcessGroup,
	table: ProcessTable,
): boolean {
	const leader = table.byPid.get(group.processGroupId);
	return (
		leader !== undefined &&
		group.leaderIdentity !== undefined &&
		processIdentity(leader) === group.leaderIdentity
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
	for (const [pid, identity] of ownedProcesses) {
		const current = table.byPid.get(pid);
		if (current && processIdentity(current) === identity) roots.push(pid);
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
		if (owned) ownedProcesses.set(pid, processIdentity(owned));
	}
}

/** Returns only PID generations that still match the current process table. */
export function getLiveOwnedProcesses(
	ownedProcesses: ReadonlyMap<number, string>,
	table: ProcessTable,
): ProcessInfo[] {
	const live: ProcessInfo[] = [];
	for (const [pid, identity] of ownedProcesses) {
		const current = table.byPid.get(pid);
		if (current && processIdentity(current) === identity) live.push(current);
	}
	return live;
}
