import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withResolvedClineBuildEnv } from "@clinebot/shared";
import { verifyHubConnection } from "./client";
import {
	type HubEndpointOverrides,
	resolveHubEndpointOptions,
} from "./defaults";
import {
	createHubServerUrl,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	writeHubDiscovery,
} from "./discovery";
import { resolveSharedHubOwnerContext } from "./workspace";

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
	const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
	return fileURLToPath(new URL(`./daemon-entry.${extension}`, import.meta.url));
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
	const isBunRuntime = basename(execPath).toLowerCase().includes("bun");
	const useDevelopmentConditions =
		isBunRuntime && daemonEntryPath.toLowerCase().endsWith(".ts");
	return {
		launcher: execPath,
		args: [
			...(useDevelopmentConditions ? ["--conditions=development"] : []),
			daemonEntryPath,
			"--cwd",
			workspaceRoot,
			...endpointArgs(endpoint),
		],
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
	const resolvedEndpoint = resolveHubEndpointOptions(endpoint);
	const expectedUrl = createHubServerUrl(
		resolvedEndpoint.host,
		resolvedEndpoint.port,
		resolvedEndpoint.pathname,
	);
	void readHubDiscovery(owner.discoveryPath)
		.then(async (discovered) => {
			if (discovered?.url) {
				const healthy = await probeHubServer(discovered.url);
				if (healthy?.url && (await verifyHubConnection(healthy.url))) {
					return;
				}
			}
			const expected = await probeHubServer(expectedUrl);
			if (expected?.url && (await verifyHubConnection(expected.url))) {
				await writeHubDiscovery(owner.discoveryPath, expected);
				return;
			}
			const spawnEndpoint =
				expected?.url && resolvedEndpoint.port !== 0
					? { ...resolvedEndpoint, port: 0 }
					: resolvedEndpoint;
			spawnDetachedHubServer(workspaceRoot, spawnEndpoint);
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
	const expectedUrl = createHubServerUrl(
		endpoint.host,
		endpoint.port,
		endpoint.pathname,
	);
	const discovered = await readHubDiscovery(owner.discoveryPath);
	if (discovered?.url) {
		const healthy = await probeHubServer(discovered.url);
		if (healthy?.url && (await verifyHubConnection(healthy.url))) {
			return healthy.url;
		}
	}
	const expected = await probeHubServer(expectedUrl);
	if (expected?.url && (await verifyHubConnection(expected.url))) {
		await writeHubDiscovery(owner.discoveryPath, expected);
		return expected.url;
	}
	const spawnEndpoint =
		expected?.url && endpoint.port !== 0 ? { ...endpoint, port: 0 } : endpoint;
	spawnDetachedHubServer(workspaceRoot, spawnEndpoint);
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const nextDiscovery = await readHubDiscovery(owner.discoveryPath);
		if (nextDiscovery?.url) {
			const healthy = await probeHubServer(nextDiscovery.url);
			if (healthy?.url && (await verifyHubConnection(healthy.url))) {
				return healthy.url;
			}
		}
		const nextExpected = await probeHubServer(expectedUrl);
		if (nextExpected?.url && (await verifyHubConnection(nextExpected.url))) {
			await writeHubDiscovery(owner.discoveryPath, nextExpected);
			return nextExpected.url;
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	throw new Error("Timed out waiting for detached hub startup.");
}
