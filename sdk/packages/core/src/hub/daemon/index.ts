import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	isHubDaemonProcess,
	isHubProtocolCompatible,
	resolveClineBuildEnv,
	withResolvedClineBuildEnv,
} from "@cline/shared";
import {
	rememberRecoverableLocalHubUrl,
	requestHubShutdown,
	verifyHubConnection,
} from "../client";
import {
	clearHubDiscovery,
	createHubServerUrl,
	type HubServerDiscoveryRecord,
	type HubServerProbeRecord,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
} from "../discovery";
import {
	type HubEndpointOverrides,
	resolveHubEndpointOptions,
} from "../discovery/defaults";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";

const HUB_STARTUP_TIMEOUT_MS = 8_000;
const HUB_STARTUP_POLL_MS = 200;
const HUB_RETIRE_TIMEOUT_MS = 3_000;
const HUB_RETIRE_POLL_MS = 100;
const HUB_SPAWN_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000];
const COMPILED_BUN_HUB_DAEMON_ARG = "--cline-hub-daemon";

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

function resolveDefaultHubOwnerContext() {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

function isCompatibleHubRecord(record: HubServerProbeRecord): boolean {
	return isHubProtocolCompatible(record).compatible;
}

async function safeProbeHubServer(
	url: string,
	authToken?: string,
): Promise<HubServerProbeRecord | undefined> {
	try {
		return await probeHubServer(url, { authToken });
	} catch {
		return undefined;
	}
}

async function waitForHubToRetire(
	url: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const healthy = await safeProbeHubServer(url);
		if (!healthy?.url) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_RETIRE_POLL_MS));
	}
	return false;
}

async function retireDiscoveredHub(
	record: Pick<HubServerDiscoveryRecord, "url" | "authToken" | "pid">,
	discoveryPath: string,
): Promise<boolean> {
	await requestHubShutdown(record.url, record.authToken).catch(() => false);
	if (record.pid) {
		try {
			process.kill(record.pid, "SIGTERM");
		} catch {
			// Best-effort cleanup only. A compatible hub may still start on a fallback port.
		}
	}
	const retired = await waitForHubToRetire(record.url, HUB_RETIRE_TIMEOUT_MS);
	await clearHubDiscovery(discoveryPath).catch(() => undefined);
	return retired;
}

async function retireIncompatibleHub(
	record: HubServerProbeRecord,
	discoveryPath: string,
): Promise<boolean> {
	if (isCompatibleHubRecord(record)) {
		return true;
	}
	return retireDiscoveredHub(record, discoveryPath);
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
	const isCompiledBunEmbeddedEntry = daemonEntryPath.startsWith("/$bunfs/");
	const useDevelopmentConditions =
		isBunRuntime && daemonEntryPath.toLowerCase().endsWith(".ts");
	const entryArgs = isCompiledBunEmbeddedEntry
		? [COMPILED_BUN_HUB_DAEMON_ARG]
		: [
				...(useDevelopmentConditions ? ["--conditions=development"] : []),
				daemonEntryPath,
			];
	return {
		launcher: execPath,
		args: [...entryArgs, "--cwd", workspaceRoot, ...endpointArgs(endpoint)],
		cwd: workspaceRoot,
		env: {
			...withResolvedClineBuildEnv(process.env),
			CLINE_NO_INTERACTIVE: "1",
			[CLINE_RUN_AS_HUB_DAEMON_ENV]: "1",
		},
	};
}

function isTextFileBusyError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const code = "code" in error ? error.code : undefined;
	if (code === "ETXTBSY") {
		return true;
	}
	const message = "message" in error ? error.message : undefined;
	return typeof message === "string" && message.includes("ETXTBSY");
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

export async function spawnDetachedHubServerWithRetry(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides = {},
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			spawnDetachedHubServer(workspaceRoot, endpoint);
			return;
		} catch (error) {
			const delay = HUB_SPAWN_RETRY_DELAYS_MS[attempt];
			if (!isTextFileBusyError(error) || delay === undefined) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

export function prewarmDetachedHubServer(
	workspaceRoot: string,
	endpoint: HubEndpointOverrides & { allowPortFallback?: boolean } = {},
): void {
	if (isHubDaemonProcess()) {
		return;
	}
	const owner = resolveDefaultHubOwnerContext();
	const resolvedEndpoint = resolveHubEndpointOptions(endpoint);
	const expectedUrl = createHubServerUrl(
		resolvedEndpoint.host,
		resolvedEndpoint.port,
		resolvedEndpoint.pathname,
	);
	const shouldUseFallbackPort =
		endpoint.allowPortFallback === true && resolvedEndpoint.port !== 0;
	void readHubDiscovery(owner.discoveryPath)
		.then(async (discovered) => {
			let retiredUnusableDiscovery = false;
			if (discovered?.url) {
				if (!discovered.authToken) {
					retiredUnusableDiscovery = true;
					const retired = await retireDiscoveredHub(
						discovered,
						owner.discoveryPath,
					);
					if (!retired && !shouldUseFallbackPort) {
						return;
					}
				} else {
					const healthy = await safeProbeHubServer(
						discovered.url,
						discovered.authToken,
					);
					if (
						healthy?.url &&
						isCompatibleHubRecord(healthy) &&
						(await verifyHubConnection(healthy.url, {
							authToken: discovered.authToken,
						}))
					) {
						return;
					}
					if (healthy?.url) {
						await retireIncompatibleHub(
							{ ...healthy, authToken: discovered.authToken },
							owner.discoveryPath,
						);
					} else {
						await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
					}
				}
			}
			const expected = await safeProbeHubServer(expectedUrl);
			if (expected?.url) {
				if (isCompatibleHubRecord(expected)) {
					if (!shouldUseFallbackPort || !retiredUnusableDiscovery) {
						return;
					}
				} else {
					const retiredExpected = await retireIncompatibleHub(
						{ ...expected, authToken: undefined },
						owner.discoveryPath,
					);
					if (!retiredExpected && !shouldUseFallbackPort) {
						return;
					}
				}
			}
			const spawnEndpoint = shouldUseFallbackPort
				? { ...resolvedEndpoint, port: 0 }
				: resolvedEndpoint;
			await spawnDetachedHubServerWithRetry(workspaceRoot, spawnEndpoint);
		})
		.catch(() => {
			// best-effort prewarm only
		});
}

export interface DetachedHubResolution {
	url: string;
	authToken: string;
}

export async function ensureDetachedHubServer(
	workspaceRoot: string,
	endpointOverrides: HubEndpointOverrides & {
		allowPortFallback?: boolean;
	} = {},
): Promise<DetachedHubResolution> {
	const owner = resolveDefaultHubOwnerContext();
	const hasExplicitEndpoint =
		endpointOverrides.host !== undefined ||
		endpointOverrides.port !== undefined ||
		endpointOverrides.pathname !== undefined ||
		!!process.env.CLINE_HUB_PORT?.trim();
	const endpoint = resolveHubEndpointOptions(endpointOverrides);
	const expectedUrl = createHubServerUrl(
		endpoint.host,
		endpoint.port,
		endpoint.pathname,
	);
	const rememberIfManaged = (
		result: DetachedHubResolution,
	): DetachedHubResolution => {
		if (!hasExplicitEndpoint) {
			rememberRecoverableLocalHubUrl(result.url, result.authToken);
		}
		return result;
	};
	const discovered = await readHubDiscovery(owner.discoveryPath);
	let retiredUnusableDiscovery = false;
	if (discovered?.url) {
		const discoveredAuthToken = discovered.authToken;
		if (!discoveredAuthToken) {
			retiredUnusableDiscovery = true;
			await retireDiscoveredHub(discovered, owner.discoveryPath);
		} else {
			const healthy = await safeProbeHubServer(
				discovered.url,
				discoveredAuthToken,
			);
			if (
				healthy?.url &&
				isCompatibleHubRecord(healthy) &&
				(await verifyHubConnection(healthy.url, {
					authToken: discoveredAuthToken,
				}))
			) {
				return rememberIfManaged({
					url: healthy.url,
					authToken: discoveredAuthToken,
				});
			}
			if (healthy?.url) {
				await retireIncompatibleHub(
					{ ...healthy, authToken: discoveredAuthToken },
					owner.discoveryPath,
				);
			} else {
				await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
			}
		}
	}
	const expected = await safeProbeHubServer(expectedUrl);
	if (expected?.url) {
		if (isCompatibleHubRecord(expected)) {
			const upgradeHint = retiredUnusableDiscovery
				? " This can happen immediately after upgrading from a build that wrote an empty hub auth token; run 'cline doctor fix' to stop the old daemon and repair local hub discovery."
				: "";
			throw new Error(
				`A compatible Cline Hub is already running at ${expectedUrl}, but its discovery record is missing or unreadable. Run 'cline doctor fix' to repair local hub discovery.${upgradeHint}`,
			);
		}
		const retiredExpected = await retireIncompatibleHub(
			{ ...expected, authToken: undefined },
			owner.discoveryPath,
		);
		if (
			!retiredExpected &&
			endpointOverrides.allowPortFallback !== true &&
			endpoint.port !== 0
		) {
			throw new Error(
				`An incompatible Cline Hub is already running at ${expectedUrl} and could not be retired automatically. Run 'cline doctor fix' to stop stale hub daemons before starting a new hub.`,
			);
		}
	}
	const shouldUseFallbackPort =
		endpointOverrides.allowPortFallback === true && endpoint.port !== 0;
	const spawnEndpoint = shouldUseFallbackPort
		? { ...endpoint, port: 0 }
		: endpoint;
	await spawnDetachedHubServerWithRetry(workspaceRoot, spawnEndpoint);
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const nextDiscovery = await readHubDiscovery(owner.discoveryPath);
		if (nextDiscovery?.url && nextDiscovery.authToken) {
			const healthy = await safeProbeHubServer(
				nextDiscovery.url,
				nextDiscovery.authToken,
			);
			if (
				healthy?.url &&
				isCompatibleHubRecord(healthy) &&
				(await verifyHubConnection(healthy.url, {
					authToken: nextDiscovery.authToken,
				}))
			) {
				return rememberIfManaged({
					url: healthy.url,
					authToken: nextDiscovery.authToken,
				});
			}
		}
		const nextExpected = await safeProbeHubServer(expectedUrl);
		if (nextExpected?.url && !isCompatibleHubRecord(nextExpected)) {
			const retiredExpected = await retireIncompatibleHub(
				{ ...nextExpected, authToken: undefined },
				owner.discoveryPath,
			);
			if (
				!retiredExpected &&
				endpointOverrides.allowPortFallback !== true &&
				endpoint.port !== 0
			) {
				throw new Error(
					`An incompatible Cline Hub is still running at ${expectedUrl} and could not be retired automatically. Run 'cline doctor fix' to stop stale hub daemons before starting a new hub.`,
				);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	throw new Error("Timed out waiting for detached hub startup.");
}
