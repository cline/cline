import { readFileSync } from "node:fs";

/**
 * The tick unit of /proc/<pid>/stat starttime. Fixed at 100 by the kernel ABI
 * exposed to userspace (USER_HZ), independent of the kernel's internal HZ.
 */
const LINUX_USER_HZ = 100;

/**
 * /proc/stat btime has whole-second granularity and starttime has tick
 * granularity, so an honest comparison needs a little slack. Kept far below
 * the ~3s minimum age of any process that could hold a recycled hub pid (see
 * hubProcessStartMatchesReport).
 */
const HUB_PROCESS_START_SLACK_MS = 2_000;

export interface ProcReader {
	platform: NodeJS.Platform;
	readFile(path: string): string;
}

const defaultProcReader: ProcReader = {
	platform: process.platform,
	readFile: (path) => readFileSync(path, "utf8"),
};

/**
 * Wall-clock start of a process, from /proc/<pid>/stat field 22 (starttime,
 * USER_HZ ticks since boot) anchored by /proc/stat btime (boot time, epoch
 * seconds). Linux only; undefined wherever /proc is missing or unparsable.
 */
export function readLinuxProcessStartWallClockMs(
	pid: number,
	reader: ProcReader = defaultProcReader,
): number | undefined {
	if (reader.platform !== "linux") {
		return undefined;
	}
	try {
		const stat = reader.readFile(`/proc/${pid}/stat`);
		// comm (field 2) is "(name)" and the name may itself contain spaces or
		// parens, so the fixed-position fields start after the LAST ")".
		const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
		const startTicks = Number(afterComm.split(" ")[19]);
		const btimeLine = reader
			.readFile("/proc/stat")
			.split("\n")
			.find((line) => line.startsWith("btime "));
		const bootSeconds = Number(btimeLine?.slice("btime ".length).trim());
		if (!Number.isFinite(startTicks) || !Number.isFinite(bootSeconds)) {
			return undefined;
		}
		return bootSeconds * 1_000 + (startTicks * 1_000) / LINUX_USER_HZ;
	} catch {
		return undefined;
	}
}

/**
 * True only when the process behind `pid` provably is the hub that reported
 * `startedAt`: a process always starts before its own listen timestamp, so
 * the /proc start time must not be later than the report (plus clock-
 * granularity slack). A recycled pid always fails this — recycling requires
 * the reporting daemon to have died first, which is after it answered the
 * probe, so any impostor is younger than the report, never older.
 *
 * /proc is read here, at the last instant before the caller signals, so the
 * identity is bound to the process holding the pid now — not to whatever
 * held it when the probe answered. Where /proc is unavailable (macOS,
 * Windows) the identity cannot be proven and this returns false: leaking a
 * daemon is the better failure than an unowned SIGKILL.
 */
export function hubProcessStartMatchesReport(
	pid: number,
	reportedStartedAt: string | undefined,
	reader: ProcReader = defaultProcReader,
): boolean {
	if (!reportedStartedAt) {
		return false;
	}
	const reportedMs = Date.parse(reportedStartedAt);
	if (!Number.isFinite(reportedMs)) {
		return false;
	}
	const processStartMs = readLinuxProcessStartWallClockMs(pid, reader);
	if (processStartMs === undefined) {
		return false;
	}
	return processStartMs <= reportedMs + HUB_PROCESS_START_SLACK_MS;
}

export type BoundKillOutcome = "killed" | "spared" | "gone";

export interface BoundKillDeps {
	reader: ProcReader;
	kill(pid: number, signal: NodeJS.Signals): void;
}

function isNoSuchProcessError(error: unknown): boolean {
	return (
		!!error &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code?: unknown }).code === "ESRCH"
	);
}

/**
 * SIGKILLs `pid` only while it provably is the hub that reported
 * `startedAt`, with the verification bound to the very process the signal
 * lands on: the pid is frozen with SIGSTOP first, its /proc start time is
 * read while frozen, and only then is it SIGKILLed — or SIGCONTed and spared
 * when the identity does not hold.
 *
 * The freeze is what closes the verify-to-kill window. A stopped process
 * cannot run, so it cannot exit, so its pid cannot be recycled between the
 * /proc read and the signal; and SIGSTOP cannot be caught, blocked, or
 * ignored. If pid reuse already happened before the freeze, the /proc read
 * sees the impostor's younger start time and the impostor is thawed with
 * SIGCONT, having lost only the microseconds it spent stopped — a
 * recoverable imposition, where SIGKILL is not. (A pidfd would remove even
 * the residual exposure to third parties signalling the frozen process, but
 * Node exposes no pidfd API; this is the strongest binding available from
 * userspace JS.)
 *
 * Non-Linux platforms return "spared" before any signal is sent: without
 * /proc there is no identity to verify, and leaking a daemon is the better
 * failure than an unowned kill.
 */
export function killHubProcessBoundToReport(
	pid: number,
	reportedStartedAt: string | undefined,
	deps: BoundKillDeps = {
		reader: defaultProcReader,
		kill: (target, signal) => process.kill(target, signal),
	},
): BoundKillOutcome {
	if (deps.reader.platform !== "linux") {
		return "spared";
	}
	if (!reportedStartedAt || !Number.isFinite(Date.parse(reportedStartedAt))) {
		return "spared";
	}
	try {
		deps.kill(pid, "SIGSTOP");
	} catch (error) {
		// ESRCH: already exited, nothing left to retire. Anything else (EPERM):
		// not ours to signal, so it cannot be the daemon we spawned.
		return isNoSuchProcessError(error) ? "gone" : "spared";
	}
	if (!hubProcessStartMatchesReport(pid, reportedStartedAt, deps.reader)) {
		try {
			deps.kill(pid, "SIGCONT");
		} catch {
			// Exited while stopped, or was never ours; either way nothing to thaw.
		}
		return "spared";
	}
	try {
		deps.kill(pid, "SIGKILL");
	} catch (error) {
		return isNoSuchProcessError(error) ? "gone" : "spared";
	}
	return "killed";
}
