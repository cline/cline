import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	isHubDaemonProcess,
	withResolvedClineBuildEnv,
} from "@clinebot/shared";
import { requestHubShutdown, verifyHubConnection } from "../client";
import {
	clearHubDiscovery,
	createHubServerUrl,
	type HubServerDiscoveryRecord,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	resolveHubBuildId,
	writeHubDiscovery,
} from "../discovery";
import {
	type HubEndpointOverrides,
	resolveHubEndpointOptions,
} from "../discovery/defaults";
import { resolveSharedHubOwnerContext } from "../discovery/workspace";

const HUB_STARTUP_TIMEOUT_MS = 8_000;
const HUB_STARTUP_POLL_MS = 200;
const HUB_RETIRE_TIMEOUT_MS = 3_000;
const HUB_RETIRE_POLL_MS = 100;

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

function isCompatibleHubRecord(record: HubServerDiscoveryRecord): boolean {
	const recordBuildId = record.buildId?.trim();
	return !!recordBuildId && recordBuildId === resolveHubBuildId();
}

async function waitForHubToRetire(
	url: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const healthy = await probeHubServer(url).catch(() => undefined);
		if (!healthy?.url) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_RETIRE_POLL_MS));
	}
	return false;
}

async function retireIncompatibleHub(
	record: HubServerDiscoveryRecord,
	discoveryPath: string,
): Promise<void> {
	if (isCompatibleHubRecord(record)) {
		return;
	}
	await requestHubShutdown(record.url).catch(() => false);
	if (record.pid) {
		try {
			process.kill(record.pid, "SIGTERM");
		} catch {
			// Best-effort cleanup only. A compatible hub may still start on a fallback port.
		}
	}
	await waitForHubToRetire(record.url, HUB_RETIRE_TIMEOUT_MS);
	await clearHubDiscovery(discoveryPath).catch(() => undefined);
}

function resolveDaemonEntryPath(): string {
	const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
	return fileURLToPath(new URL(`./entry.${extension}`, import.meta.url));
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
			[CLINE_RUN_AS_HUB_DAEMON_ENV]: "1",
		},
	};
}

export function spawnDetachedHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): void {
	if (isHubDaemonProcess()) {
		return;
	}
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
	if (isHubDaemonProcess()) {
		return;
	}
	const owner = resolveSharedHubOwnerContext();
	const hasExplicitPort =
		endpoint.port !== undefined || !!process.env.CLINE_HUB_PORT?.trim();
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
				if (
					healthy?.url &&
					isCompatibleHubRecord(healthy) &&
					(await verifyHubConnection(healthy.url))
				) {
					return;
				}
				if (healthy?.url) {
					await retireIncompatibleHub(healthy, owner.discoveryPath);
				} else {
					await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
				}
			}
			const expected = await probeHubServer(expectedUrl);
			if (
				expected?.url &&
				isCompatibleHubRecord(expected) &&
				(await verifyHubConnection(expected.url))
			) {
				await writeHubDiscovery(owner.discoveryPath, expected);
				return;
			}
			if (expected?.url) {
				await retireIncompatibleHub(expected, owner.discoveryPath);
			}
			const shouldUseFallbackPort =
				!hasExplicitPort && resolvedEndpoint.port !== 0;
			const spawnEndpoint = shouldUseFallbackPort
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
	const hasExplicitPort =
		endpointOverrides.port !== undefined ||
		!!process.env.CLINE_HUB_PORT?.trim();
	const endpoint = resolveHubEndpointOptions(endpointOverrides);
	const expectedUrl = createHubServerUrl(
		endpoint.host,
		endpoint.port,
		endpoint.pathname,
	);
	const discovered = await readHubDiscovery(owner.discoveryPath);
	if (discovered?.url) {
		const healthy = await probeHubServer(discovered.url);
		if (
			healthy?.url &&
			isCompatibleHubRecord(healthy) &&
			(await verifyHubConnection(healthy.url))
		) {
			return healthy.url;
		}
		if (healthy?.url) {
			await retireIncompatibleHub(healthy, owner.discoveryPath);
		} else {
			await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
		}
	}
	const expected = await probeHubServer(expectedUrl);
	if (
		expected?.url &&
		isCompatibleHubRecord(expected) &&
		(await verifyHubConnection(expected.url))
	) {
		await writeHubDiscovery(owner.discoveryPath, expected);
		return expected.url;
	}
	if (expected?.url) {
		await retireIncompatibleHub(expected, owner.discoveryPath);
	}
	const shouldUseFallbackPort = !hasExplicitPort && endpoint.port !== 0;
	const spawnEndpoint = shouldUseFallbackPort
		? { ...endpoint, port: 0 }
		: endpoint;
	spawnDetachedHubServer(workspaceRoot, spawnEndpoint);
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const nextDiscovery = await readHubDiscovery(owner.discoveryPath);
		if (nextDiscovery?.url) {
			const healthy = await probeHubServer(nextDiscovery.url);
			if (
				healthy?.url &&
				isCompatibleHubRecord(healthy) &&
				(await verifyHubConnection(healthy.url))
			) {
				return healthy.url;
			}
		}
		const nextExpected = await probeHubServer(expectedUrl);
		if (
			nextExpected?.url &&
			isCompatibleHubRecord(nextExpected) &&
			(await verifyHubConnection(nextExpected.url))
		) {
			await writeHubDiscovery(owner.discoveryPath, nextExpected);
			return nextExpected.url;
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	throw new Error("Timed out waiting for detached hub startup.");
}
