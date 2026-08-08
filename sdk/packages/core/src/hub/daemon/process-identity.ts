import { readFileSync } from "node:fs";

export interface ProcReader {
	platform: NodeJS.Platform;
	readFile(path: string): string;
}

const defaultProcReader: ProcReader = {
	platform: process.platform,
	readFile: (path) => readFileSync(path, "utf8"),
};

/**
 * starttime: field 22 of /proc/<pid>/stat, the kernel's tick count at the
 * instant the process was created. Immutable for the process's whole life
 * and strictly increasing across successive holders of a recycled pid, so
 * two reads returning the same integer for the same pid prove the pid was
 * not recycled between them — an exact identity, needing no wall-clock
 * conversion and no tolerance window. Linux only; undefined wherever /proc
 * is missing or unparsable.
 */
export function readLinuxProcessStartTicks(
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
		return Number.isFinite(startTicks) ? startTicks : undefined;
	} catch {
		return undefined;
	}
}

/**
 * A process identity captured at a point in time: this pid was held by the
 * process with this exact start tick. Capture it BEFORE probing the hub, so
 * that an unchanged ticket at kill time brackets the probe — whoever
 * answered in between was this same process.
 */
export interface ProcessStartTicket {
	pid: number;
	startTicks: number;
}

export function captureProcessStartTicket(
	pid: number,
	reader: ProcReader = defaultProcReader,
): ProcessStartTicket | undefined {
	const startTicks = readLinuxProcessStartTicks(pid, reader);
	return startTicks === undefined ? undefined : { pid, startTicks };
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
 * SIGKILLs the ticket's pid only while it is still the very process the
 * ticket was captured from, with the verification bound to the process the
 * signal lands on: the pid is frozen with SIGSTOP first, its start tick is
 * re-read while frozen, and only an exact integer match is killed — anything
 * else is thawed with SIGCONT and spared.
 *
 * Two properties make this airtight against pid reuse, with no tolerance
 * window to slip through:
 *
 * - The freeze closes the verify-to-kill gap. A stopped process cannot run,
 *   so it cannot exit, so its pid cannot be recycled between the /proc read
 *   and the signal; and SIGSTOP cannot be caught, blocked, or ignored.
 * - The start tick is exact. It never changes for a live process, and any
 *   successor on a recycled pid was necessarily created later, at a strictly
 *   greater tick — so equality with the pre-probe ticket proves the frozen
 *   process is the one that held the pid before the probe, and therefore the
 *   one that answered it. There is no wall-clock conversion and no slack: a
 *   recycled pid cannot pass, however quickly it was recycled.
 *
 * A process that fails the check loses only the microseconds it spent
 * stopped — a recoverable imposition, where SIGKILL is not. (A pidfd would
 * remove even the residual exposure to third parties signalling the frozen
 * process, but Node exposes no pidfd API; this is the strongest binding
 * available from userspace JS.)
 *
 * Non-Linux platforms return "spared" before any signal is sent: without
 * /proc there is no identity to verify, and leaking a daemon is the better
 * failure than an unowned kill.
 */
export function killHubProcessBoundToTicket(
	ticket: ProcessStartTicket,
	deps: BoundKillDeps = {
		reader: defaultProcReader,
		kill: (target, signal) => process.kill(target, signal),
	},
): BoundKillOutcome {
	if (deps.reader.platform !== "linux") {
		return "spared";
	}
	try {
		deps.kill(ticket.pid, "SIGSTOP");
	} catch (error) {
		// ESRCH: already exited, nothing left to retire. Anything else (EPERM):
		// not ours to signal, so it cannot be the daemon we spawned.
		return isNoSuchProcessError(error) ? "gone" : "spared";
	}
	const frozenTicks = readLinuxProcessStartTicks(ticket.pid, deps.reader);
	if (frozenTicks === undefined || frozenTicks !== ticket.startTicks) {
		try {
			deps.kill(ticket.pid, "SIGCONT");
		} catch {
			// Exited while stopped, or was never ours; either way nothing to thaw.
		}
		return "spared";
	}
	try {
		deps.kill(ticket.pid, "SIGKILL");
	} catch (error) {
		return isNoSuchProcessError(error) ? "gone" : "spared";
	}
	return "killed";
}
