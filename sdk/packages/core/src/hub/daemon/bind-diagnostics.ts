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

const LOOKUP_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_000;

/** `lsof -Fpc` emits `p<pid>` then `c<command>` per process. */
export function parseLsofOwners(output: string): string[] {
	const owners: string[] = [];
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith("p")) {
			owners.push(line.slice(1));
		} else if (line.startsWith("c") && owners.length > 0) {
			owners[owners.length - 1] += `\t${line.slice(1)}`;
		}
	}
	return owners;
}

/**
 * One `pid<TAB>process` line per listener, or undefined when no tool answered.
 * Only the process name and executable path are collected, never its
 * arguments: an unrelated program's command line may carry credentials.
 */
function listPortOwners(port: number): string[] | undefined {
	const [command, args] =
		process.platform === "win32"
			? [
					"powershell",
					[
						"-NoProfile",
						"-NonInteractive",
						"-Command",
						`Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$_"; "$_\`t$($p.Name) $($p.ExecutablePath)" }`,
					],
				]
			: ["lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]];
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: LOOKUP_TIMEOUT_MS,
		windowsHide: true,
	});
	// lsof exits 1 when nothing listens, so exit status alone cannot tell a
	// failed lookup from an empty one; a tool that complained instead of
	// answering is treated as unavailable.
	if (result.error || (!result.stdout.trim() && result.stderr.trim())) {
		return undefined;
	}
	const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim());
	return process.platform === "win32" ? lines : parseLsofOwners(result.stdout);
}

function redactUserPaths(value: string): string {
	return value
		.replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
		.replace(/\/home\/[^/\s]+/g, "/home/[redacted]")
		.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/g, "$1[redacted]");
}

/** Telemetry context for a `hub.daemon.startup` failure caused by `EADDRINUSE`. */
export async function describeAddressInUse(
	error: unknown,
	endpoint: { host: string; port: number; pathname: string },
): Promise<TelemetryProperties> {
	const context: TelemetryProperties = {
		bind_port: endpoint.port,
		instance_lock_held: (error as { hubInstanceLockHeld?: boolean })
			.hubInstanceLockHeld,
	};
	const owners = listPortOwners(endpoint.port);
	context.port_owners = owners
		? redactUserPaths(owners.join(" | ")).slice(0, 600)
		: "unavailable";
	const occupant = await probeHubServer(
		createHubServerUrl(endpoint.host, endpoint.port, endpoint.pathname),
		{ signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
	);
	context.occupant_is_hub = occupant !== undefined;
	if (occupant) {
		context.occupant_hub_build_id = occupant.buildId;
		context.occupant_hub_core_version = occupant.coreVersion;
		context.occupant_hub_pid = occupant.pid;
	}
	return context;
}
