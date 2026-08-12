import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

const PROCESS_PROBE_TIMEOUT_MS = 2_000;
const PROCESS_PROBE_MAX_BUFFER_BYTES = 4_096;

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

function formatExternalProcessStartToken(output: string): string | undefined {
	const startTime = output.trim();
	return startTime ? `${process.platform}:${startTime}` : undefined;
}

export function parseLinuxProcessStartToken(
	stat: string,
	bootId: string,
): string | undefined {
	const commandEnd = stat.lastIndexOf(")");
	if (commandEnd < 0) return undefined;

	// Fields after the command name begin at field 3 (state), so field 22
	// (starttime) is index 19. Use the final ')' because Linux permits ')' in
	// the parenthesized command name.
	const fields = stat
		.slice(commandEnd + 1)
		.trim()
		.split(/\s+/);
	if (["Z", "X", "x"].includes(fields[0] ?? "")) return undefined;
	const startTime = fields[19];
	const normalizedBootId = bootId.trim();
	return startTime && normalizedBootId
		? `linux:${normalizedBootId}:${startTime}`
		: undefined;
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
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return undefined;
	}

	try {
		if (process.platform === "linux") {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8");
			return parseLinuxProcessStartToken(stat, bootId);
		}

		const command = resolveProcessStartCommand(pid);
		const result = spawnSync(command.file, command.args, {
			encoding: "utf8",
			env: command.env,
			maxBuffer: PROCESS_PROBE_MAX_BUFFER_BYTES,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: PROCESS_PROBE_TIMEOUT_MS,
			windowsHide: true,
		});
		return result.status === 0 && typeof result.stdout === "string"
			? formatExternalProcessStartToken(result.stdout)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Non-blocking process-token probe for latency-sensitive runtime paths. */
export async function getProcessStartTokenAsync(
	pid: number,
): Promise<string | undefined> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;

	try {
		if (process.platform === "linux") {
			const [stat, bootId] = await Promise.all([
				readFile(`/proc/${pid}/stat`, "utf8"),
				readFile("/proc/sys/kernel/random/boot_id", "utf8"),
			]);
			return parseLinuxProcessStartToken(stat, bootId);
		}

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
					resolve(
						error || typeof stdout !== "string"
							? undefined
							: formatExternalProcessStartToken(stdout),
					);
				},
			);
		});
	} catch {
		return undefined;
	}
}
