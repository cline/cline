/**
 * Best-effort description of who holds the Hub port when the daemon dies with
 * `EADDRINUSE`. The daemon takes the owner instance lock before binding, so an
 * occupant on the port is never a live Hub for this owner; these details tell
 * us what it actually is (an older pre-lock Hub, a leaked handle, another
 * owner context, or an unrelated program) so the fix can target that case.
 */

import { spawnSync } from "node:child_process";
import type { TelemetryProperties } from "@cline/shared";
import { createHubServerUrl, probeHubServer } from "../discovery";

const COMMAND_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_000;
const MAX_COMMAND_LINE_LENGTH = 300;

export interface PortOwner {
	pid: number;
	command?: string;
}

export function isAddressInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error as Error & { code?: string }).code === "EADDRINUSE"
	);
}

function run(command: string, args: string[]): string | undefined {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: COMMAND_TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.error || result.status !== 0) {
		return undefined;
	}
	return result.stdout;
}

/** `netstat -ano` rows: `TCP  127.0.0.1:25463  0.0.0.0:0  LISTENING  1234`. */
export function parseNetstatListeners(output: string, port: number): number[] {
	const pids = new Set<number>();
	for (const line of output.split(/\r?\n/)) {
		const fields = line.trim().split(/\s+/);
		if (
			fields[0] !== "TCP" ||
			!fields[1]?.endsWith(`:${port}`) ||
			fields[3] !== "LISTENING"
		) {
			continue;
		}
		const pid = Number.parseInt(fields[4] ?? "", 10);
		if (Number.isInteger(pid) && pid > 0) {
			pids.add(pid);
		}
	}
	return [...pids];
}

/** `lsof -Fpc` field output: `p1234` then `ccline` per process. */
export function parseLsofListeners(output: string): PortOwner[] {
	const owners: PortOwner[] = [];
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith("p")) {
			const pid = Number.parseInt(line.slice(1), 10);
			if (Number.isInteger(pid) && pid > 0) {
				owners.push({ pid });
			}
		} else if (line.startsWith("c") && owners.length > 0) {
			owners[owners.length - 1].command = line.slice(1);
		}
	}
	return owners;
}

/** `ss -ltnpH` rows end with `users:(("cline",pid=1234,fd=5))`. */
export function parseSsListeners(output: string): PortOwner[] {
	const owners: PortOwner[] = [];
	for (const match of output.matchAll(/\("([^"]*)",pid=(\d+)/g)) {
		owners.push({ pid: Number.parseInt(match[2], 10), command: match[1] });
	}
	return owners;
}

function windowsCommandLine(pid: number): string | undefined {
	const viaCim = run("powershell", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		`(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
	])?.trim();
	if (viaCim) {
		return viaCim;
	}
	// `"cline.exe","1234","Console","1","12,345 K"`
	const viaTasklist = run("tasklist", [
		"/FI",
		`PID eq ${pid}`,
		"/FO",
		"CSV",
		"/NH",
	])?.match(/^"([^"]*)"/m)?.[1];
	return viaTasklist || undefined;
}

function unixCommandLine(pid: number): string | undefined {
	return run("ps", ["-o", "command=", "-p", String(pid)])?.trim() || undefined;
}

function redactUserPaths(value: string): string {
	return value
		.replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
		.replace(/\/home\/[^/\s]+/g, "/home/[redacted]")
		.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/g, "$1[redacted]");
}

export function listPortOwners(port: number): {
	lookup: string;
	owners: PortOwner[];
} {
	if (process.platform === "win32") {
		const output = run("netstat", ["-ano"]);
		if (output === undefined) {
			return { lookup: "netstat_unavailable", owners: [] };
		}
		return {
			lookup: "netstat",
			owners: parseNetstatListeners(output, port).map((pid) => ({
				pid,
				command: windowsCommandLine(pid),
			})),
		};
	}
	const lsof = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
	if (lsof !== undefined) {
		return {
			lookup: "lsof",
			owners: parseLsofListeners(lsof).map((owner) => ({
				...owner,
				command: unixCommandLine(owner.pid) ?? owner.command,
			})),
		};
	}
	const ss = run("ss", ["-ltnpH", `sport = :${port}`]);
	if (ss !== undefined) {
		return {
			lookup: "ss",
			owners: parseSsListeners(ss).map((owner) => ({
				...owner,
				command: unixCommandLine(owner.pid) ?? owner.command,
			})),
		};
	}
	return { lookup: "unavailable", owners: [] };
}

/**
 * Telemetry context for a `hub.daemon.startup` failure caused by
 * `EADDRINUSE`. Never throws; every field is best-effort.
 */
export async function describeAddressInUse(
	error: unknown,
	endpoint: { host: string; port: number; pathname: string },
): Promise<TelemetryProperties> {
	const raw = error as {
		errno?: unknown;
		syscall?: unknown;
		hubInstanceLockHeld?: unknown;
	};
	const context: TelemetryProperties = {
		bind_host: endpoint.host,
		bind_port: endpoint.port,
	};
	if (typeof raw.errno === "number") {
		context.error_errno = raw.errno;
	}
	if (typeof raw.syscall === "string") {
		context.error_syscall = raw.syscall;
	}
	if (typeof raw.hubInstanceLockHeld === "boolean") {
		context.instance_lock_held = raw.hubInstanceLockHeld;
	}

	try {
		const { lookup, owners } = listPortOwners(endpoint.port);
		context.port_owner_lookup = lookup;
		context.port_owner_pids = owners.map((owner) => owner.pid).join(",");
		context.port_owner_commands = owners
			.map(
				(owner) =>
					`${owner.pid}: ${redactUserPaths(owner.command ?? "?").slice(0, MAX_COMMAND_LINE_LENGTH)}`,
			)
			.join(" | ");
	} catch (lookupError) {
		context.port_owner_lookup = `error: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}`;
	}

	try {
		const url = createHubServerUrl(
			endpoint.host,
			endpoint.port,
			endpoint.pathname,
		);
		const occupant = await probeHubServer(url, {
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		context.occupant_is_hub = occupant !== undefined;
		if (occupant) {
			if (occupant.buildId) {
				context.occupant_hub_build_id = occupant.buildId;
			}
			if (occupant.coreVersion) {
				context.occupant_hub_core_version = occupant.coreVersion;
			}
			if (occupant.protocolVersion) {
				context.occupant_hub_protocol_version = occupant.protocolVersion;
			}
			if (typeof occupant.pid === "number") {
				context.occupant_hub_pid = occupant.pid;
			}
		}
	} catch {
		context.occupant_is_hub = false;
	}

	return context;
}
