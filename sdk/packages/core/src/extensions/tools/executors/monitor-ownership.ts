/**
 * Process ownership and termination for one monitor.
 *
 * A monitor must eventually kill everything it started and nothing else. PIDs
 * are reusable numbers, so every claim here is backed by a generation check:
 * a process is only ever adopted or signaled while its identity (start time,
 * process group, command) still matches what was recorded when it was
 * provably ours.
 *
 * The root of that trust chain is the direct child. Its identity is anchored
 * at spawn time — before its PID can possibly be released — and every later
 * process-table row claiming its PID is verified against that anchor before
 * it can root ownership. A JS-side `ChildProcess` reporting null exit fields
 * is deliberately *not* trusted as proof on POSIX: the OS releases the PID
 * when the child is reaped inside libuv, an instant before the JS fields
 * update, so an in-flight table snapshot can catch a recycled PID while the
 * fields still read null. Whenever ownership cannot be proven, the process is
 * disowned and leaked rather than adopted.
 */

import { type ChildProcess, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	getLiveOwnedProcesses,
	killWindowsProcessesByGeneration,
	observeOwnedProcessTree,
	type ProcessInfo,
	type ProcessTable,
	parseProcessTable,
	parseProcStat,
	processIdentity,
	readProcessTable,
	selectProvenGroupLeaders,
} from "./process-tree";

const ANCHOR_PS_TIMEOUT_MS = 2_000;
const PROCESS_EXIT_POLL_INTERVAL_MS = 50;

/**
 * The spawned shell's identity, captured while its PID was unforgeable.
 *
 * The command is deliberately excluded: `sh -c` execs a sole simple command
 * in place of the shell, which rewrites the command line while preserving the
 * PID, start time, and process group — exactly the immutable parts kept here.
 */
export interface SpawnedProcessAnchor {
	pid: number;
	startedAt: string;
	processGroupId: number;
}

/**
 * JS-side view of the direct child at observation time. `running` reflects
 * `exitCode === null && signalCode === null`, evaluated *after* the table
 * read it accompanies (see {@link MonitorProcessOwnership.observe}).
 */
export interface DirectChildState {
	pid?: number;
	running: boolean;
}

export function isChildProcessRunning(child: ChildProcess): boolean {
	return child.exitCode === null && child.signalCode === null;
}

export interface OwnedProcessTerminationOptions {
	/** Time allowed for graceful shutdown before SIGKILL. */
	gracePeriodMs: number;
	/** How long to wait for SIGKILL to land before reporting survivors. */
	killTimeoutMs: number;
}

/**
 * Pins the direct child's identity in the same synchronous tick as `spawn()`.
 *
 * Between `spawn()` returning and this call, the event loop has not turned,
 * so libuv cannot have reaped the child: even if the process already exited,
 * it is at worst an unreaped zombie whose PID the OS cannot recycle and whose
 * start time and process group are still readable. That makes this the one
 * moment a numeric PID provably names the spawned shell, and the identity
 * read here the only safe root for all later ownership claims.
 *
 * libuv's spawn also completes the child-side `setsid()`/exec handshake
 * before returning (the parent blocks on the error pipe until exec), so the
 * process group observed here is the child's own, not a pre-exec transient.
 *
 * On Windows this returns undefined: a synchronous PowerShell/CIM query costs
 * seconds, and it is unnecessary — libuv holds an open handle to the process
 * object until after the JS exit fields are set, and Windows cannot recycle a
 * PID with an open handle, so the anchor can be pinned from the first table
 * row observed while the fields are still null (see {@link
 * MonitorProcessOwnership.observe}).
 *
 * Returns undefined when the identity cannot be read; the monitor then owns
 * nothing beyond the child's own Node handle, and descendants are leaked
 * rather than guessed at.
 */
export function captureSpawnedProcessAnchor(
	pid: number | undefined,
): SpawnedProcessAnchor | undefined {
	if (!pid) return undefined;
	if (process.platform === "win32") return undefined;

	if (process.platform === "linux") {
		try {
			const info = parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
			if (info && info.pid === pid) {
				return {
					pid,
					startedAt: info.startedAt,
					processGroupId: info.processGroupId,
				};
			}
		} catch {
			// The stat file could not be read; ownership stays unprovable.
		}
		return undefined;
	}

	// POSIX without procfs: one bounded synchronous `ps` read. Synchronous on
	// purpose — an async read would reopen the reap-then-reuse window this
	// anchor exists to close. Monitor starts are rare and capped, so the cost
	// is acceptable. spawnSync runs its own event loop, which reaps only its
	// own child, never the monitor's.
	try {
		const result = spawnSync(
			"ps",
			["-ww", "-o", "pid=,ppid=,pgid=,lstart=,command=", "-p", String(pid)],
			{
				encoding: "utf8",
				timeout: ANCHOR_PS_TIMEOUT_MS,
				windowsHide: true,
				// LC_ALL=C pins `lstart` to the asctime layout the parser expects.
				env: { ...process.env, LC_ALL: "C" },
			},
		);
		if (result.status === 0 && result.stdout) {
			const info = parseProcessTable(result.stdout).byPid.get(pid);
			if (info) {
				return {
					pid,
					startedAt: info.startedAt,
					processGroupId: info.processGroupId,
				};
			}
		}
	} catch {
		// `ps` unavailable or wedged; ownership stays unprovable.
	}
	return undefined;
}

/**
 * Tracks and terminates the processes provably owned by one monitor.
 *
 * All adoption flows through {@link observe}, and every path in it requires
 * positive identity proof rooted in the spawn-time anchor. All termination
 * flows through {@link signal}, and it only targets identities validated
 * against the same table snapshot the caller just read.
 */
export class MonitorProcessOwnership {
	/** PID generations observed while they were descendants of this monitor. */
	private readonly ownedProcesses = new Map<number, string>();
	/**
	 * The group leader's full identity as of the last anchor-verified
	 * observation. Refreshed on every verified sighting (not recorded once)
	 * because an exec rewrites the leader's command while the anchor's
	 * immutable parts still prove it is the same process.
	 */
	private groupIdentity?: string;

	/** Set once termination gives up, so the exit poll stops looping. */
	private abandoned = false;

	constructor(
		private anchor: SpawnedProcessAnchor | undefined,
		/**
		 * Process group led by the direct child, set at spawn on POSIX where
		 * the child is detached. Survives the wrapper's exit, so it still
		 * attributes descendants once parent links point at a reaped PID.
		 */
		private readonly ownedProcessGroupId?: number,
	) {}

	/** Reads one fresh table snapshot and extends ownership from it. */
	async refresh(
		child: ChildProcess | undefined,
	): Promise<ProcessTable | undefined> {
		const table = await readProcessTable();
		if (!table) return undefined;
		this.observeChild(table, child);
		return table;
	}

	/**
	 * {@link observe} with the JS-side child state computed here, after the
	 * caller's table read has completed — the ordering the Windows anchor
	 * pinning depends on.
	 */
	observeChild(table: ProcessTable, child: ChildProcess | undefined): void {
		this.observe(table, {
			pid: child?.pid,
			running: child ? isChildProcessRunning(child) : false,
		});
	}

	/**
	 * Runs the full termination sequence against everything provably owned:
	 * SIGTERM, a bounded grace period, revalidation against a fresh table,
	 * SIGKILL, then a bounded wait for the kill to land.
	 *
	 * SIGKILL cannot be trapped, but it can still fail to land: the signal
	 * may be refused (EPERM after a privilege change), or the target may sit
	 * unreapable in uninterruptible sleep. Waiting unconditionally would block
	 * stop(), dispose(), and with them session shutdown, for as long as that
	 * lasts — so the wait is bounded, and the survivors are reported instead
	 * of hanging: a leaked process is recoverable, a wedged shutdown is not.
	 *
	 * Returns an error description when survivors remain, undefined otherwise.
	 */
	async terminate(
		child: ChildProcess,
		options: OwnedProcessTerminationOptions,
	): Promise<string | undefined> {
		const initialTable = await this.refresh(child);
		const initialProcesses = initialTable
			? this.liveProcesses(initialTable)
			: [];
		if (!isChildProcessRunning(child) && initialProcesses.length === 0) {
			return undefined;
		}

		const exited = this.waitForAllExited(child);
		// On Windows both signals degrade to TerminateProcess, so the "grace"
		// phase is nominal there — the first pass already kills outright, and
		// the escalation just re-reads the table to catch late descendants.
		this.signal(child, initialProcesses, "SIGTERM");
		if (await waitUntil(exited, options.gracePeriodMs)) return undefined;

		// Re-read the table before escalation, so a numeric PID is signaled
		// only when its identity still matches the monitor-owned generation
		// captured while it was a descendant — PID reuse during the grace
		// period cannot redirect the kill to unrelated work.
		const finalTable = await this.refresh(child);
		const finalProcesses = finalTable ? this.liveProcesses(finalTable) : [];
		this.signal(child, finalProcesses, "SIGKILL");
		if (await waitUntil(exited, options.killTimeoutMs)) return undefined;

		this.abandoned = true;
		const survivorTable = await readProcessTable();
		const survivors = survivorTable ? this.liveProcesses(survivorTable) : [];
		const detail = survivors.length
			? survivors.map((survivor) => survivor.pid).join(", ")
			: "unknown";
		return `left process(es) running after SIGKILL (pid ${detail})`;
	}

	/** Resolves once the child and every validated owned process are gone. */
	private async waitForAllExited(child: ChildProcess): Promise<void> {
		if (isChildProcessRunning(child)) await waitForChildExit(child);

		while (true) {
			if (this.abandoned) return;
			const table = await this.refresh(child);
			if (!table || this.liveProcesses(table).length === 0) return;
			await new Promise((resolve) =>
				setTimeout(resolve, PROCESS_EXIT_POLL_INTERVAL_MS),
			);
		}
	}

	/**
	 * Extends ownership from the current table snapshot.
	 *
	 * The direct child roots the tree only when the table row at its PID
	 * matches the spawn-time anchor. A recycled PID presents a different
	 * start time, so a foreign occupant — even one observed while the JS
	 * child object still reports null exit fields — can never be adopted,
	 * and neither can its descendants. Previously recorded descendants keep
	 * their own pinned generations and survive the root's death independently.
	 */
	observe(table: ProcessTable, child: DirectChildState): void {
		this.pinWindowsAnchor(table, child);
		const root = this.verifiedChildRow(table, child.pid);
		if (root) this.groupIdentity = processIdentity(root);
		observeOwnedProcessTree(
			this.ownedProcesses,
			root ? [root.pid] : [],
			table,
			this.ownedProcessGroupId
				? [
						{
							processGroupId: this.ownedProcessGroupId,
							leaderIdentity: this.groupIdentity,
						},
					]
				: [],
		);
	}

	/** Owned generations that still match the given table snapshot. */
	liveProcesses(table: ProcessTable): ProcessInfo[] {
		return getLiveOwnedProcesses(this.ownedProcesses, table);
	}

	/**
	 * Signals the validated owned set, plus the direct child via its own
	 * handle.
	 *
	 * On POSIX, a process group is blanket-signaled only when its leader is
	 * present in the validated set with the recorded generation
	 * ({@link selectProvenGroupLeaders}); the direct child's group id is
	 * deliberately not added on the strength of null JS exit fields, since
	 * that is the same released-PID trust this class exists to remove. When
	 * no table could be read, only the child's own Node handle is signaled
	 * and unobserved descendants are leaked, never guessed at.
	 */
	signal(
		child: ChildProcess | undefined,
		validated: readonly ProcessInfo[],
		signal: NodeJS.Signals,
	): void {
		if (process.platform === "win32") {
			// Validated descendants are terminated through per-process handles:
			// the kill script opens a handle by pid, re-checks the creation time
			// through that handle, and terminates the same handle's process, so
			// a pid reused after the table read cannot receive the signal. Plain
			// process.kill(pid) would leave exactly that window open.
			killWindowsProcessesByGeneration(validated);
		} else {
			for (const processGroupId of selectProvenGroupLeaders(validated)) {
				try {
					process.kill(-processGroupId, signal);
				} catch {
					// The group may already have exited after the validated table read.
				}
			}
			// POSIX kill(2) is pid-addressed, so a residual read-to-signal
			// window remains between the validating snapshot and this syscall.
			// It is microseconds wide and closing it needs pidfd/cgroup
			// primitives Node does not expose; the identity check above keeps
			// it from being *steerable* (a replacement must also match group
			// and command within the same second).
			for (const owned of validated) {
				try {
					process.kill(owned.pid, signal);
				} catch {
					// The process may already have exited after the validated table read.
				}
			}
		}
		// The direct child is also signaled through its own handle, which pid
		// reuse cannot redirect — on Windows this is the one fully race-free
		// kill, and everywhere it covers a child the table read never saw.
		if (child && isChildProcessRunning(child)) {
			child.kill(signal);
		}
	}

	/**
	 * Returns the direct child's table row iff it is provably the spawned
	 * process: same PID, same start-time token, same process group as the
	 * anchor. Without an anchor nothing is ever rooted.
	 */
	private verifiedChildRow(
		table: ProcessTable,
		pid: number | undefined,
	): ProcessInfo | undefined {
		if (!pid || !this.anchor || this.anchor.pid !== pid) return undefined;
		const row = table.byPid.get(pid);
		if (!row) return undefined;
		if (
			row.startedAt !== this.anchor.startedAt ||
			row.processGroupId !== this.anchor.processGroupId
		) {
			return undefined;
		}
		return row;
	}

	/**
	 * Windows-only lazy anchor pinning.
	 *
	 * On Windows the PID cannot be recycled while libuv's process handle is
	 * open, and that handle is closed only after the JS exit fields are set.
	 * `child.running` is evaluated after the table read completes, so fields
	 * still null at that point prove the handle was open for the entire read
	 * and the observed row is the spawned process. This ordering argument
	 * does not hold on POSIX, where reaping releases the PID before the JS
	 * fields update — hence the synchronous spawn-time anchor there.
	 */
	private pinWindowsAnchor(table: ProcessTable, child: DirectChildState): void {
		if (
			process.platform !== "win32" ||
			this.anchor ||
			!child.pid ||
			!child.running
		) {
			return;
		}
		const row = table.byPid.get(child.pid);
		if (!row) return;
		this.anchor = {
			pid: child.pid,
			startedAt: row.startedAt,
			processGroupId: row.processGroupId,
		};
	}
}

function waitForChildExit(child: ChildProcess): Promise<void> {
	if (!isChildProcessRunning(child)) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		// `close` also waits for stdio streams. An escaped descendant can keep
		// an inherited pipe open indefinitely even after this child is dead;
		// `exit` tracks the owned process itself and cannot be held by that pipe.
		const onExit = () => resolve();
		child.once("exit", onExit);
		// Cover an exit between the state check above and listener registration.
		if (!isChildProcessRunning(child)) {
			child.off("exit", onExit);
			resolve();
		}
	});
}

async function waitUntil(
	promise: Promise<void>,
	timeoutMs: number,
): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined;
	const timedOut = await Promise.race([
		promise.then(() => false),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), timeoutMs);
		}),
	]);
	if (timer) clearTimeout(timer);
	return !timedOut;
}
