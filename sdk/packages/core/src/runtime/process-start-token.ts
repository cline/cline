import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const PROCESS_PROBE_TIMEOUT_MS = 2_000;
const PROCESS_PROBE_MAX_BUFFER_BYTES = 4_096;

export type ProcessStartTokenProbeResult =
	| { status: "found"; token: string }
	| { status: "missing" }
	| { status: "unavailable" };

type ProcessExistence = "running" | "missing" | "unavailable";

type ProcessStartCommand = {
	file: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
};

function resolveProcessStartCommand(pid: number): ProcessStartCommand {
	if (process.platform === "win32") {
		return {
			file: "powershell.exe",
			args: [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
			],
		};
	}
	return {
		file: "ps",
		args: ["-p", String(pid), "-o", "lstart="],
		env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
	};
}

function getProcessExistence(pid: number): ProcessExistence {
	if (!Number.isSafeInteger(pid) || pid <= 0) return "missing";
	try {
		process.kill(pid, 0);
		return "running";
	} catch (error) {
		const code =
			error instanceof Error && "code" in error
				? String((error as NodeJS.ErrnoException).code)
				: undefined;
		if (code === "ESRCH") return "missing";
		if (code === "EPERM") return "running";
		return "unavailable";
	}
}

function classifyFailedProbe(pid: number): ProcessStartTokenProbeResult {
	return getProcessExistence(pid) === "missing"
		? { status: "missing" }
		: { status: "unavailable" };
}

function formatExternalProcessStartToken(
	output: string,
): ProcessStartTokenProbeResult | undefined {
	const startTime = output.trim();
	return startTime
		? { status: "found", token: `${process.platform}:${startTime}` }
		: undefined;
}

type LinuxProcessStatResult =
	| { status: "running"; startTime: string }
	| { status: "missing" }
	| { status: "unavailable" };

function parseLinuxProcessStat(stat: string): LinuxProcessStatResult {
	const commandEnd = stat.lastIndexOf(")");
	if (commandEnd < 0) return { status: "unavailable" };

	// Fields after the command name begin at field 3 (state), so field 22
	// (starttime) is index 19. Use the final ')' because Linux permits ')' in
	// the parenthesized command name.
	const fields = stat
		.slice(commandEnd + 1)
		.trim()
		.split(/\s+/);
	if (["Z", "X", "x"].includes(fields[0] ?? "")) {
		return { status: "missing" };
	}
	const startTime = fields[19];
	return startTime && /^\d+$/.test(startTime)
		? { status: "running", startTime }
		: { status: "unavailable" };
}

export function parseLinuxProcessStartToken(
	stat: string,
	bootId: string,
): string | undefined {
	const processStat = parseLinuxProcessStat(stat);
	const normalizedBootId = bootId.trim();
	return processStat.status === "running" && normalizedBootId
		? `linux:${normalizedBootId}:${processStat.startTime}`
		: undefined;
}

function probeLinuxProcessStartToken(
	pid: number,
	read: (path: string) => string,
): ProcessStartTokenProbeResult {
	let stat: string;
	try {
		stat = read(`/proc/${pid}/stat`);
	} catch {
		return classifyFailedProbe(pid);
	}
	const processStat = parseLinuxProcessStat(stat);
	if (processStat.status !== "running") return processStat;

	let bootId: string;
	try {
		bootId = read("/proc/sys/kernel/random/boot_id").trim();
	} catch {
		return { status: "unavailable" };
	}
	return bootId
		? {
				status: "found",
				token: `linux:${bootId}:${processStat.startTime}`,
			}
		: { status: "unavailable" };
}

/** Distinguishes an absent process from an unavailable identity probe. */
export function probeProcessStartToken(
	pid: number,
): ProcessStartTokenProbeResult {
	if (!Number.isSafeInteger(pid) || pid <= 0) return { status: "missing" };

	if (process.platform === "linux") {
		return probeLinuxProcessStartToken(pid, (path) =>
			readFileSync(path, "utf8"),
		);
	}

	const existence = getProcessExistence(pid);
	if (existence !== "running") return { status: existence };
	try {
		const command = resolveProcessStartCommand(pid);
		const result = spawnSync(command.file, command.args, {
			encoding: "utf8",
			env: command.env,
			maxBuffer: PROCESS_PROBE_MAX_BUFFER_BYTES,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: PROCESS_PROBE_TIMEOUT_MS,
			windowsHide: true,
		});
		if (result.status === 0 && typeof result.stdout === "string") {
			const token = formatExternalProcessStartToken(result.stdout);
			if (token) return token;
		}
		return classifyFailedProbe(pid);
	} catch {
		return classifyFailedProbe(pid);
	}
}

/**
 * Returns a token for one generation of a process ID.
 *
 * A PID alone is not an identity because the operating system can reuse it
 * after a process exits. The token is derived from the kernel-reported process
 * start time so callers can distinguish a live process from a later process
 * that inherited the same PID.
 */
export function getProcessStartToken(pid: number): string | undefined {
	const result = probeProcessStartToken(pid);
	return result.status === "found" ? result.token : undefined;
}

/** Non-blocking probe for latency-sensitive runtime paths. */
export async function probeProcessStartTokenAsync(
	pid: number,
): Promise<ProcessStartTokenProbeResult> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return { status: "missing" };

	if (process.platform === "linux") {
		let stat: string;
		try {
			stat = await readFile(`/proc/${pid}/stat`, "utf8");
		} catch {
			return classifyFailedProbe(pid);
		}
		const processStat = parseLinuxProcessStat(stat);
		if (processStat.status !== "running") return processStat;

		try {
			const bootId = (
				await readFile("/proc/sys/kernel/random/boot_id", "utf8")
			).trim();
			return bootId
				? {
						status: "found",
						token: `linux:${bootId}:${processStat.startTime}`,
					}
				: { status: "unavailable" };
		} catch {
			return { status: "unavailable" };
		}
	}

	const existence = getProcessExistence(pid);
	if (existence !== "running") return { status: existence };
	try {
		const command = resolveProcessStartCommand(pid);
		return await new Promise((resolve) => {
			execFile(
				command.file,
				command.args,
				{
					encoding: "utf8",
					env: command.env,
					maxBuffer: PROCESS_PROBE_MAX_BUFFER_BYTES,
					timeout: PROCESS_PROBE_TIMEOUT_MS,
					windowsHide: true,
				},
				(error, stdout) => {
					const token =
						!error && typeof stdout === "string"
							? formatExternalProcessStartToken(stdout)
							: undefined;
					resolve(token ?? classifyFailedProbe(pid));
				},
			);
		});
	} catch {
		return classifyFailedProbe(pid);
	}
}

export async function getProcessStartTokenAsync(
	pid: number,
): Promise<string | undefined> {
	const result = await probeProcessStartTokenAsync(pid);
	return result.status === "found" ? result.token : undefined;
}
