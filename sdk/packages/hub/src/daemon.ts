import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSharedHubOwnerContext } from "@clinebot/core/hub";
import { withResolvedClineBuildEnv } from "@clinebot/shared";
import { probeHubConnection } from "./client";
import {
	type HubEndpointOverrides,
	resolveHubEndpointOptions,
} from "./defaults";
import {
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
} from "./discovery";

const HUB_STARTUP_TIMEOUT_MS = 8_000;
const HUB_STARTUP_POLL_MS = 200;

function endpointArgs(endpoint: HubEndpointOverrides): string[] {
	return [
		...(endpoint.host ? ["--host", endpoint.host] : []),
		...(typeof endpoint.port === "number"
			? ["--port", String(endpoint.port)]
			: []),
		...(endpoint.pathname ? ["--pathname", endpoint.pathname] : []),
	];
}

function openDetachedHubLogFile(): { fd: number; logPath: string } | undefined {
	try {
		const logPath = join(resolveClineDataDir(), "logs", "hub-daemon.log");
		mkdirSync(dirname(logPath), { recursive: true });
		return { fd: openSync(logPath, "a"), logPath };
	} catch {
		return undefined;
	}
}

function resolveDaemonEntryPath(): string {
	return fileURLToPath(new URL("./daemon-entry.ts", import.meta.url));
}

function resolveLaunchCommand(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides,
): {
	launcher: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
} {
	const daemonEntryPath = resolveDaemonEntryPath();
	const execPath = process.execPath?.trim();
	if (!execPath) {
		throw new Error("unable to resolve runtime executable for hub daemon");
	}
	return {
		launcher: execPath,
		args: [daemonEntryPath, "--cwd", workspaceRoot, ...endpointArgs(endpoint)],
		cwd: workspaceRoot,
		env: {
			...withResolvedClineBuildEnv(process.env),
			CLINE_NO_INTERACTIVE: "1",
		},
	};
}

export function spawnDetachedHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): void {
	const command = resolveLaunchCommand(workspaceRoot, endpoint);
	const logFile = openDetachedHubLogFile();
	try {
		const child = spawn(command.launcher, command.args, {
			detached: true,
			stdio: logFile ? ["ignore", logFile.fd, logFile.fd] : "ignore",
			env: command.env,
			cwd: command.cwd,
		});
		child.unref();
	} finally {
		if (logFile) {
			closeSync(logFile.fd);
		}
	}
}

export function prewarmDetachedHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): void {
	const owner = resolveSharedHubOwnerContext();
	void readHubDiscovery(owner.discoveryPath)
		.then(async (discovered) => {
			if (discovered?.url) {
				const healthy = await probeHubServer(discovered.url);
				if (healthy?.url && (await probeHubConnection(healthy.url))) {
					return;
				}
			}
			spawnDetachedHubServer(workspaceRoot, endpoint);
		})
		.catch(() => {
			// best-effort prewarm only
		});
}

export async function ensureDetachedHubServer(
	workspaceRoot: string,
	endpointOverrides: HubEndpointOverrides = {},
): Promise<string> {
	const owner = resolveSharedHubOwnerContext();
	const endpoint = resolveHubEndpointOptions(endpointOverrides);
	const discovered = await readHubDiscovery(owner.discoveryPath);
	if (discovered?.url) {
		const healthy = await probeHubServer(discovered.url);
		if (healthy?.url && (await probeHubConnection(healthy.url))) {
			return healthy.url;
		}
	}

	spawnDetachedHubServer(workspaceRoot, endpoint);
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const nextDiscovery = await readHubDiscovery(owner.discoveryPath);
		if (nextDiscovery?.url) {
			const healthy = await probeHubServer(nextDiscovery.url);
			if (healthy?.url && (await probeHubConnection(healthy.url))) {
				return healthy.url;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	throw new Error("Timed out waiting for detached hub startup.");
}
