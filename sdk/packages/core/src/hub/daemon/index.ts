import { spawn } from "node:child_process";
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	isHubDaemonProcess,
	resolveClineBuildEnv,
	withResolvedClineBuildEnv,
} from "@cline/shared";
import {
	localHubHasNoActiveSessions,
	rememberRecoverableLocalHubUrl,
	requestHubShutdown,
	verifyHubConnection,
} from "../client";
import {
	clearHubDiscovery,
	createHubServerUrl,
	type HubOwnerContext,
	type HubServerDiscoveryRecord,
	type HubServerProbeRecord,
	isManagedHubReusable,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	withHubStartupLock,
	writeHubDiscovery,
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
const HUB_RETIRE_ATTEMPT_LIMIT = 3;
const HUB_RETIRE_ATTEMPT_WINDOW_MS = 60_000;

const retireAttemptsByUrl = new Map<
	string,
	{ count: number; windowStartedAt: number }
>();

export const __test__ = {
	/** Retire attempts are module state keyed by URL; clear between cases. */
	resetRetireAttempts(): void {
		retireAttemptsByUrl.clear();
	},
};

/**
 * Circuit breaker on repeated retirements of the same Hub URL.
 *
 * Build ordering already guarantees that only one side of a pair can decide to
 * retire, so a healthy install retires a given URL once. Retiring the same URL
 * over and over means something upstream is wrong, and the failure mode is
 * severe: long-lived clients (sidecars, interactive CLI sessions) tear each
 * other's daemon down in a tight loop and every session dies with an abnormal
 * socket close. Backing off after a few attempts keeps a future ordering bug to
 * a stale-build prompt instead of an unusable Hub.
 */
function shouldAttemptRetire(url: string, now = Date.now()): boolean {
	const entry = retireAttemptsByUrl.get(url);
	if (!entry || now - entry.windowStartedAt > HUB_RETIRE_ATTEMPT_WINDOW_MS) {
		retireAttemptsByUrl.set(url, { count: 1, windowStartedAt: now });
		return true;
	}
	entry.count += 1;
	return entry.count <= HUB_RETIRE_ATTEMPT_LIMIT;
}

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

function isReusableHubRecord(record: HubServerProbeRecord): boolean {
	return isManagedHubReusable(record);
}

/**
 * Reads the discovery record the npm postinstall set aside (see
 * apps/cli/script/postinstall.mjs). Deliberately bypasses readHubDiscovery —
 * the file is best-effort recovery metadata, not a live record — and stays
 * synchronous so it adds no async boundary to the ensure flow.
 *
 * Exported for `cline doctor`, which must not mistake a shielded live hub for
 * a stale daemon just because its record is set aside.
 */
export function readSupersededHubDiscovery(
	discoveryPath: string,
): { url?: string; authToken?: string; pid?: number } | undefined {
	try {
		const raw = JSON.parse(
			readFileSync(`${discoveryPath}.superseded`, "utf8"),
		) as { url?: unknown; authToken?: unknown; pid?: unknown };
		return {
			url: typeof raw.url === "string" ? raw.url : undefined,
			authToken: typeof raw.authToken === "string" ? raw.authToken : undefined,
			pid: typeof raw.pid === "number" ? raw.pid : undefined,
		};
	} catch {
		return undefined;
	}
}

/**
 * The set-aside record is one-shot recovery metadata: once an ensure completes
 * with a live, verified hub it has served its purpose, and keeping it around
 * is a hazard — its pid can be recycled by the OS and a much later launch
 * that finds no live record would SIGTERM an unrelated process with it.
 */
function discardSupersededHubDiscovery(discoveryPath: string): void {
	try {
		unlinkSync(`${discoveryPath}.superseded`);
	} catch {
		// Already gone or unreadable — nothing to discard.
	}
}

function withMatchingDiscoveryRetirementMetadata(
	probe: HubServerProbeRecord,
	discovered: { url?: string; authToken?: string; pid?: number } | undefined,
	expectedUrl: string,
): HubServerProbeRecord {
	if (!discovered || discovered.url !== expectedUrl) {
		return probe;
	}
	return {
		...probe,
		authToken: probe.authToken ?? discovered.authToken,
		pid: probe.pid ?? discovered.pid,
	};
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
	record: { url: string; authToken?: string; pid?: number },
	discoveryPath: string,
): Promise<boolean> {
	if (!shouldAttemptRetire(record.url)) {
		return false;
	}
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

export type HubRetirementOutcome =
	| "reusable"
	| "retired"
	| "deferred_busy"
	| "failed";

/**
 * Whether the Hub is currently serving sessions, and so must not be shut down
 * under them.
 *
 * Failing open (treating an unanswerable Hub as idle) preserves the existing
 * replacement path for a Hub that is wedged or too old to answer the query;
 * only a Hub that positively reports live sessions is spared.
 */
async function hubHasLiveSessions(
	record: HubServerProbeRecord,
): Promise<boolean> {
	try {
		return !(await localHubHasNoActiveSessions(record.url, record.authToken));
	} catch {
		return false;
	}
}

/**
 * Retiring a Hub kills its established WebSockets, so a session running on it
 * dies mid-turn with an abnormal close. Defer instead while it is busy: the
 * caller attaches to the older Hub, the build-mismatch watcher tells the user a
 * newer build is waiting, and the swap happens at a boundary they choose.
 */
async function retireIncompatibleHub(
	record: HubServerProbeRecord,
	discoveryPath: string,
): Promise<HubRetirementOutcome> {
	if (isReusableHubRecord(record)) {
		return "reusable";
	}
	if (await hubHasLiveSessions(record)) {
		return "deferred_busy";
	}
	return (await retireDiscoveredHub(record, discoveryPath))
		? "retired"
		: "failed";
}

/**
 * Pre-singleton production builds tracked the local hub under the shared
 * owner discovery path and spawned daemons on random fallback ports. Those
 * daemons are invisible to the production owner context, so nothing would
 * ever reuse or stop them. Retire the recorded legacy hub (its record carries
 * the auth token and pid needed for a graceful stop) and clear the legacy
 * record so upgrades do not leave orphaned daemons running stale code.
 */
async function retireLegacySharedHub(owner: HubOwnerContext): Promise<void> {
	if (resolveClineBuildEnv() !== "production") {
		return;
	}
	const legacy = resolveSharedHubOwnerContext();
	if (legacy.discoveryPath === owner.discoveryPath) {
		return;
	}
	const record = await readHubDiscovery(legacy.discoveryPath);
	if (record?.url) {
		await retireDiscoveredHub(record, legacy.discoveryPath);
	} else {
		await clearHubDiscovery(legacy.discoveryPath).catch(() => undefined);
	}
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
			// Prevent a console window from appearing on Windows; detached
			// processes otherwise allocate a new visible console.
			windowsHide: true,
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
	void ensureDetachedHubServer(workspaceRoot, endpoint).catch(() => {
		// best-effort prewarm only
	});
}

export interface DetachedHubResolution {
	url: string;
	authToken: string;
}

async function ensureDetachedHubServerLocked(
	owner: HubOwnerContext,
	workspaceRoot: string,
	endpointOverrides: HubEndpointOverrides & {
		allowPortFallback?: boolean;
	} = {},
): Promise<DetachedHubResolution> {
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
	await retireLegacySharedHub(owner).catch(() => undefined);
	const discovered = await readHubDiscovery(owner.discoveryPath);
	// The npm package's postinstall sets the discovery record aside (same
	// ".superseded" suffix) so pre-3.0.55 updaters cannot restart a busy hub.
	// Without it, a hub displaced that way could never be retired here: the
	// port probe alone carries no auth token or pid.
	const superseded = discovered?.url
		? undefined
		: readSupersededHubDiscovery(owner.discoveryPath);
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
				isReusableHubRecord(healthy) &&
				(await verifyHubConnection(healthy.url, {
					authToken: discoveredAuthToken,
				}))
			) {
				discardSupersededHubDiscovery(owner.discoveryPath);
				return rememberIfManaged({
					url: healthy.url,
					authToken: discoveredAuthToken,
				});
			}
			if (healthy?.url) {
				const outcome = await retireIncompatibleHub(
					{ ...healthy, authToken: discoveredAuthToken },
					owner.discoveryPath,
				);
				// A busy older Hub is left running, so attach to it rather than
				// spawning a second daemon that would race it for the port.
				if (
					outcome === "deferred_busy" &&
					(await verifyHubConnection(healthy.url, {
						authToken: discoveredAuthToken,
					}))
				) {
					return rememberIfManaged({
						url: healthy.url,
						authToken: discoveredAuthToken,
					});
				}
			} else {
				await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
			}
		}
	}
	const expected = await safeProbeHubServer(expectedUrl);
	if (expected?.url) {
		const expectedForRetirement = withMatchingDiscoveryRetirementMetadata(
			expected,
			discovered ?? superseded,
			expectedUrl,
		);
		if (isReusableHubRecord(expected)) {
			// Live hub is healthy but discovery is missing/unreadable (or auth
			// token was empty). Prefer attaching via any known auth token rather
			// than spawning a second daemon that dies with EADDRINUSE.
			const candidateTokens = [
				expected.authToken,
				discovered?.authToken,
				superseded?.authToken,
			].filter(
				(token): token is string =>
					typeof token === "string" && token.trim().length > 0,
			);
			for (const token of candidateTokens) {
				if (
					!(await verifyHubConnection(expected.url, {
						authToken: token,
					}))
				) {
					continue;
				}
				const repaired: HubServerDiscoveryRecord = {
					hubId: expected.hubId ?? `repaired-${expected.port}`,
					protocolVersion: expected.protocolVersion,
					minClientProtocolVersion: expected.minClientProtocolVersion,
					maxClientProtocolVersion: expected.maxClientProtocolVersion,
					capabilities: expected.capabilities,
					coreVersion: expected.coreVersion,
					buildId: expected.buildId,
					authToken: token,
					host: expected.host,
					port: expected.port,
					url: expected.url,
					pid: expected.pid ?? discovered?.pid ?? superseded?.pid,
					startedAt: expected.startedAt ?? new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				};
				try {
					await writeHubDiscovery(owner.discoveryPath, repaired);
				} catch {
					// Best-effort repair; attaching still works with the token
					// we just verified even if the discovery file is unwritable.
				}
				discardSupersededHubDiscovery(owner.discoveryPath);
				return rememberIfManaged({
					url: expected.url,
					authToken: token,
				});
			}
			const upgradeHint = retiredUnusableDiscovery
				? " This can happen immediately after upgrading from a build that wrote an empty hub auth token; run 'cline doctor fix' to stop the old daemon and repair local hub discovery."
				: "";
			throw new Error(
				`A compatible Cline Hub is already running at ${expectedUrl}, but its discovery record is missing or unreadable and no usable auth token is available. Run 'cline doctor fix' to repair local hub discovery.${upgradeHint}`,
			);
		}
		const expectedOutcome = await retireIncompatibleHub(
			expectedForRetirement,
			owner.discoveryPath,
		);
		if (expectedOutcome === "deferred_busy") {
			// Same as above: the older Hub is still serving sessions, so attach
			// with whichever token verifies instead of replacing it.
			for (const token of [
				expectedForRetirement.authToken,
				discovered?.authToken,
			].filter(
				(candidate): candidate is string =>
					typeof candidate === "string" && candidate.trim().length > 0,
			)) {
				if (await verifyHubConnection(expected.url, { authToken: token })) {
					return rememberIfManaged({ url: expected.url, authToken: token });
				}
			}
			if (endpointOverrides.allowPortFallback !== true && endpoint.port !== 0) {
				throw new Error(
					`An older Cline Hub is running at ${expectedUrl} and is still serving active sessions, so it was not replaced, but no usable auth token is available to attach to it. Finish those sessions, or run 'cline doctor fix' to stop the hub.`,
				);
			}
		}
		if (
			expectedOutcome === "failed" &&
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
				isReusableHubRecord(healthy) &&
				(await verifyHubConnection(healthy.url, {
					authToken: nextDiscovery.authToken,
				}))
			) {
				discardSupersededHubDiscovery(owner.discoveryPath);
				return rememberIfManaged({
					url: healthy.url,
					authToken: nextDiscovery.authToken,
				});
			}
		}
		const nextExpected = await safeProbeHubServer(expectedUrl);
		if (nextExpected?.url && !isReusableHubRecord(nextExpected)) {
			const expectedForRetirement = withMatchingDiscoveryRetirementMetadata(
				nextExpected,
				nextDiscovery ?? superseded,
				expectedUrl,
			);
			const nextOutcome = await retireIncompatibleHub(
				expectedForRetirement,
				owner.discoveryPath,
			);
			if (
				nextOutcome === "deferred_busy" &&
				nextDiscovery?.authToken &&
				(await verifyHubConnection(nextExpected.url, {
					authToken: nextDiscovery.authToken,
				}))
			) {
				return rememberIfManaged({
					url: nextExpected.url,
					authToken: nextDiscovery.authToken,
				});
			}
			if (
				nextOutcome === "failed" &&
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

export async function ensureDetachedHubServer(
	workspaceRoot: string,
	endpointOverrides: HubEndpointOverrides & {
		allowPortFallback?: boolean;
	} = {},
): Promise<DetachedHubResolution> {
	const owner = resolveDefaultHubOwnerContext();
	return await withHubStartupLock(owner.discoveryPath, async () =>
		ensureDetachedHubServerLocked(owner, workspaceRoot, endpointOverrides),
	);
}
