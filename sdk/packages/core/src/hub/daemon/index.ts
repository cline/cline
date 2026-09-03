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
	queryHubSessionActivity,
	rememberRecoverableLocalHubUrl,
	requestHubDrain,
	requestHubShutdown,
	verifyHubConnection,
} from "../client";
import {
	clearHubDiscovery,
	compareHubBuilds,
	createHubServerUrl,
	getManagedHubCompatibility,
	type HubOwnerContext,
	type HubServerDiscoveryRecord,
	type HubServerProbeRecord,
	isManagedHubReusable,
	probeHubServer,
	readHubDiscovery,
	resolveClineDataDir,
	resolveHubBuildIdentity,
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

/**
 * Gracefully retire a discovered hub. Shared by every replacement path
 * (detached ensure, in-process ensure) so retirement always means the same
 * thing: drain first, then an authenticated shutdown, SIGTERM only as a
 * last resort, and discovery cleared only once the hub is actually gone.
 */
export async function retireDiscoveredHub(
	record: { url: string; authToken?: string; pid?: number },
	discoveryPath: string,
): Promise<boolean> {
	if (!shouldAttemptRetire(record.url)) {
		return false;
	}
	// Graceful handover, in order of increasing force: drain (refuse new
	// work), then an authenticated shutdown, then SIGTERM only as a fallback
	// and only at a pid we can positively observe alive right now — a recorded
	// pid may have been recycled by the OS onto an unrelated process.
	await requestHubDrain(
		record.url,
		record.authToken,
		"retired by newer install",
	).catch(() => false);
	await requestHubShutdown(record.url, record.authToken).catch(() => false);
	let retired = await waitForHubToRetire(record.url, HUB_RETIRE_TIMEOUT_MS);
	if (!retired && record.pid && isPidAlive(record.pid)) {
		try {
			process.kill(record.pid, "SIGTERM");
		} catch {
			// Best-effort cleanup only. A compatible hub may still start on a fallback port.
		}
		retired = await waitForHubToRetire(record.url, HUB_RETIRE_TIMEOUT_MS);
	}
	// Only the successful retirement may clear discovery: clearing the record
	// of a hub that survived leaves a live daemon undiscoverable, recoverable
	// only through the expected-URL probe/repair path.
	if (retired) {
		await clearHubDiscovery(discoveryPath).catch(() => undefined);
	}
	return retired;
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as { code?: string })?.code === "EPERM";
	}
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
export async function hubHasLiveSessions(
	record: Pick<HubServerProbeRecord, "url" | "authToken">,
): Promise<boolean> {
	try {
		const activity = await queryHubSessionActivity(
			record.url,
			record.authToken,
		);
		return activity.activeSessionCount > 0;
	} catch {
		return false;
	}
}

/**
 * Retiring a Hub kills its established WebSockets, so a session running on it
 * dies mid-turn with an abnormal close. Defer instead while it is busy: the
 * caller attaches to the older Hub, the build-mismatch watcher tells the user a
 * newer build is waiting, and the swap happens at a boundary they choose.
 *
 * The drain comes BEFORE the busy check, not after: an idle reading is only
 * a snapshot, and a session admitted between it and the shutdown would die
 * in a retirement that "idle" was supposed to rule out. With the drain
 * accepted first, the hub admits no new work, so the reading stays true
 * through the retire. A hub that does not accept the drain (builds that
 * predate /drain answer 404; a wedged one may not answer at all) keeps the
 * historical best-effort snapshot - never replacing such a hub would strand
 * every client on it permanently, the very failure this path exists to fix.
 */
async function retireIncompatibleHub(
	record: HubServerProbeRecord,
	discoveryPath: string,
): Promise<HubRetirementOutcome> {
	if (isReusableHubRecord(record)) {
		return "reusable";
	}
	const drained = await requestHubDrain(
		record.url,
		record.authToken,
		"retired by newer install",
	).catch(() => false);
	if (await hubHasLiveSessions(record)) {
		// Deferring means the hub keeps serving its sessions, so hand it back:
		// a deferred hub left draining would refuse all new work until restart.
		if (drained) {
			await requestHubDrain(
				record.url,
				record.authToken,
				"hub retirement deferred",
				{ off: true },
			).catch(() => false);
		}
		return "deferred_busy";
	}
	const retired = await retireDiscoveredHub(record, discoveryPath);
	// A hub that survived the ladder (or was skipped by the retire circuit
	// breaker) keeps running, so hand it back too - drained-but-alive is a
	// limbo that refuses all new work until something restarts it.
	if (!retired && drained) {
		await requestHubDrain(
			record.url,
			record.authToken,
			"hub retirement failed",
			{ off: true },
		).catch(() => false);
	}
	return retired ? "retired" : "failed";
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

const HUB_UPGRADE_DEFAULT_WAIT_MS = 5_000;
const HUB_UPGRADE_IDLE_POLL_MS = 500;

export interface UpgradeManagedHubOptions {
	workspaceRoot?: string;
	/**
	 * How long to wait, after draining, for the hub's live sessions to finish
	 * before replacing it (`force`) or giving up (`still_busy`).
	 */
	waitForIdleMs?: number;
	/**
	 * Replace the hub even if sessions are still live once the wait expires.
	 * Only set this on a user-consented path: those sessions die mid-turn.
	 * Honored only once the hub has accepted the drain - a busy hub that
	 * refused the drain is never replaced, because the drain is what protects
	 * work started during the wait window.
	 */
	force?: boolean;
	/** Recorded as the hub's drain reason, visible in `hub.status`. */
	reason?: string;
}

export type UpgradeManagedHubOutcome =
	/** The running older hub was retired and a current-build hub is up. */
	| "replaced"
	/** No live hub was found; a current-build hub was started. */
	| "started"
	/** The running hub already matches this build; nothing to do. */
	| "already_current"
	/**
	 * The running hub is newer than (or unorderable against) this build.
	 * Replacing it would downgrade another install's hub and reopen the
	 * mutual-retire loop (#13145), so it is refused; updating this client is
	 * the fix.
	 */
	| "hub_not_older"
	/** `force` was not set and sessions never finished - or the hub's
	 * activity could never be confirmed, which counts as busy here; the hub
	 * was un-drained and left running. */
	| "still_busy";

export interface UpgradeManagedHubResult {
	outcome: UpgradeManagedHubOutcome;
	url?: string;
	authToken?: string;
	/**
	 * Live sessions observed on the old hub at decision time: the sessions
	 * that were interrupted (`replaced`) or that kept it running
	 * (`still_busy`). Omitted when the hub never answered the activity query.
	 */
	activeSessionCount?: number;
}

/**
 * Replace the managed local hub with one running this build, on the user's
 * explicit say-so. This is the deliberate counterpart to the automatic
 * replacement in `ensureDetachedHubServer`, which defers while the older hub
 * is serving sessions: drain first (the hub refuses new work while in-flight
 * turns get `waitForIdleMs` to finish), then the shared graceful retire
 * ladder, then a fresh daemon. Drain-first is a guarantee, not a courtesy:
 * this function retires a hub only under an accepted drain, because the
 * drain is the admission barrier that keeps any busy or idle reading true
 * through the retire. A hub that refuses the drain fails the upgrade
 * outright - `force` does not override that, and neither does an idle
 * reading, which without the drain is only a snapshot that a newly admitted
 * session could invalidate before the retire lands. (Such a hub is still
 * replaced by the automatic ensure path once idle at the next client
 * startup, the pre-existing recovery route for hubs too old to serve
 * /drain.) Activity readings that fail are treated as unknown, not idle:
 * they never shorten the wait window, and without `force` an unconfirmed
 * hub is handed back un-drained rather than retired.
 *
 * Never replaces a hub this build is not strictly newer than - the build
 * total order guarantees at most one side of any install pair can reach the
 * retire step, which is what keeps two mixed installs from taking turns
 * "upgrading" the hub to their own build.
 */
export async function upgradeManagedHub(
	options: UpgradeManagedHubOptions = {},
): Promise<UpgradeManagedHubResult> {
	const owner = resolveDefaultHubOwnerContext();
	const workspaceRoot = options.workspaceRoot ?? process.cwd();
	const discovered = await readHubDiscovery(owner.discoveryPath);
	const live = discovered?.url
		? await safeProbeHubServer(discovered.url, discovered.authToken)
		: undefined;
	if (!live?.url) {
		const ensured = await ensureDetachedHubServer(workspaceRoot);
		return { outcome: "started", ...ensured };
	}
	const record = {
		...live,
		authToken: live.authToken ?? discovered?.authToken,
		pid: live.pid ?? discovered?.pid,
	};
	if (getManagedHubCompatibility(live).compatible) {
		return {
			outcome: "already_current",
			url: live.url,
			authToken: record.authToken,
		};
	}
	if (compareHubBuilds(resolveHubBuildIdentity(), live) <= 0) {
		return {
			outcome: "hub_not_older",
			url: live.url,
			authToken: record.authToken,
		};
	}
	const drained = await requestHubDrain(
		record.url,
		record.authToken,
		options.reason ?? "hub upgrade requested",
	).catch(() => false);
	// No accepted drain, no upgrade - unconditionally. The drain is the
	// admission barrier that keeps every reading below true through the
	// retire; without it even a positively idle reading is a snapshot that a
	// session admitted a moment later would invalidate, and that session
	// would die in a retire the user's consent prompt never covered. A hub
	// too old or too wedged to accept the drain is still replaced by the
	// automatic ensure path once it is idle at the next client startup.
	if (!drained) {
		throw new Error(
			`The running Cline Hub at ${record.url} did not accept a drain request, so it was not replaced. It is replaced automatically once idle when a Cline client next starts, or run 'cline doctor fix' to stop it now.`,
		);
	}
	// An aborted upgrade must hand the hub back: leaving it draining refuses
	// all new mutating work until a restart.
	const undrain = async (): Promise<void> => {
		await requestHubDrain(record.url, record.authToken, "hub upgrade aborted", {
			off: true,
		}).catch(() => false);
	};
	const deadline =
		Date.now() + (options.waitForIdleMs ?? HUB_UPGRADE_DEFAULT_WAIT_MS);
	// A failed reading is "unknown", never "idle": it must not end the wait
	// window early, overwrite the last real observation, or authorize a
	// retirement by itself - a transient query blip while turns are still
	// finishing must not cut short the grace the drain exists to provide.
	// Only an observed-zero reading ends the window before the deadline.
	// (Checks at least once so waitForIdleMs: 0 still observes an idle hub.)
	let observedSessionCount: number | undefined;
	for (;;) {
		try {
			observedSessionCount = (
				await queryHubSessionActivity(record.url, record.authToken)
			).activeSessionCount;
			if (observedSessionCount === 0) {
				break;
			}
		} catch {
			// Unknown; keep polling until the deadline.
		}
		if (Date.now() >= deadline) {
			break;
		}
		await new Promise((resolve) =>
			setTimeout(resolve, HUB_UPGRADE_IDLE_POLL_MS),
		);
	}
	const confirmedIdle = observedSessionCount === 0;
	// Without force, only a positively idle hub may be replaced: a busy or
	// unanswerable hub is handed back un-drained. With force, the user has
	// already consented to interrupting the sessions the prompt showed them,
	// and the accepted drain keeps new work out from here through the retire.
	if (!confirmedIdle && options.force !== true) {
		await undrain();
		return {
			outcome: "still_busy",
			url: record.url,
			authToken: record.authToken,
			...(observedSessionCount !== undefined
				? { activeSessionCount: observedSessionCount }
				: {}),
		};
	}
	if (!(await retireDiscoveredHub(record, owner.discoveryPath))) {
		await undrain();
		throw new Error(
			`The running Cline Hub at ${record.url} could not be stopped. Run 'cline doctor fix' to stop stale hub daemons, then try again.`,
		);
	}
	const ensured = await ensureDetachedHubServer(workspaceRoot);
	return {
		outcome: "replaced",
		...ensured,
		activeSessionCount: observedSessionCount ?? 0,
	};
}
