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
