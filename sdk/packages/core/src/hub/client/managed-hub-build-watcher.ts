import { existsSync } from "node:fs";
import { isHubDaemonProcess, resolveClineBuildEnv } from "@cline/shared";
import {
	compareHubBuilds,
	getManagedHubCompatibility,
	type HubOwnerContext,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
	resolveHubBuildIdentity,
} from "../discovery";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";
import { queryHubSessionActivity } from "./index";

const DEFAULT_WATCH_INTERVAL_MS = 10_000;
const WATCH_INTERVAL_ENV = "CLINE_HUB_BUILD_WATCH_INTERVAL_MS";

function resolveDefaultWatchIntervalMs(): number {
	const configured = Number(process.env[WATCH_INTERVAL_ENV]);
	return Number.isFinite(configured) && configured > 0
		? configured
		: DEFAULT_WATCH_INTERVAL_MS;
}

export interface ManagedHubBuildMismatchEvent {
	/** WebSocket URL of the live managed Hub that does not match this build. */
	url: string;
	/**
	 * Why client and Hub disagree:
	 * - `build_mismatch`: the running Hub is a newer build this client stays
	 *   attached to, and updating this client resolves it.
	 * - `unsupported_protocol`: this client cannot speak the Hub's protocol.
	 * - `outdated_hub`: this client is the newer build, but the running Hub was
	 *   left in place because it is still serving sessions. Nothing to install;
	 *   the Hub is replaced once those sessions end.
	 * - `missing_capability`: this client needs a capability the running Hub
	 *   lacks. The Hub is not newer than this client, so replacing it with this
	 *   build fixes it; nothing is replaced automatically.
	 */
	reason:
		| "unsupported_protocol"
		| "build_mismatch"
		| "outdated_hub"
		| "missing_capability";
	/** Build identity reported by the running Hub, when it reports one. */
	hubBuildId?: string;
	/** Core package version reported by the running Hub. */
	hubCoreVersion?: string;
	/** Build identity this client expects a managed Hub to match. */
	expectedBuildId: string;
	/** Required capabilities the running Hub lacks (`missing_capability` only). */
	missingCapabilities?: string[];
	/**
	 * Sessions with live participants on the Hub (best-effort,
	 * `outdated_hub` and `missing_capability` only): the work that replacing
	 * the Hub would interrupt. Unset when the Hub cannot answer the query.
	 */
	activeSessionCount?: number;
	/**
	 * Distinct clients attached to those sessions (best-effort,
	 * `outdated_hub` and `missing_capability` only).
	 */
	participantClientCount?: number;
}

export interface CheckManagedHubBuildOptions {
	/**
	 * Hub capabilities this client cannot work without. A Hub that is not
	 * newer than this client and lacks one is reported as `missing_capability`.
	 */
	requiredCapabilities?: readonly string[];
}

/**
 * Best-effort enrichment for the cases that ask to replace the Hub: how much
 * live work it is serving, so surfaces can say "updating now interrupts N
 * sessions" instead of asking for blind consent. A Hub that cannot answer
 * leaves the fields unset rather than failing the check.
 */
async function withHubSessionActivity(
	event: ManagedHubBuildMismatchEvent,
	authToken?: string,
): Promise<ManagedHubBuildMismatchEvent> {
	try {
		const activity = await queryHubSessionActivity(event.url, authToken);
		return {
			...event,
			activeSessionCount: activity.activeSessionCount,
			participantClientCount: activity.participantClientCount,
		};
	} catch {
		return event;
	}
}

function resolveDefaultHubOwnerContext(): HubOwnerContext {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

function isHubStartupLockHeld(discoveryPath: string): boolean {
	try {
		return existsSync(`${discoveryPath}.lock`);
	} catch {
		return false;
	}
}

/**
 * The health probe carries no capability list, so ask the Hub's
 * authenticated status endpoint. A Hub that does not answer is unknown, not
 * lacking; one that answers without a list predates every capability.
 */
async function findMissingHubCapabilities(
	record: { url: string; authToken?: string },
	requiredCapabilities: readonly string[],
): Promise<string[] | undefined> {
	const status = await probeHubServer(record.url, {
		authToken: record.authToken,
	}).catch(() => undefined);
	if (!status) {
		return undefined;
	}
	return requiredCapabilities.filter(
		(capability) => !status.capabilities?.includes(capability),
	);
}

/**
 * Probe the managed local Hub once and report whether a live Hub is running
 * a build this client cannot manage. Returns `undefined` when there is no
 * discovery record, the recorded Hub is unreachable, a Hub startup
 * transaction is in flight (another client may be mid-replacement), or the
 * running Hub matches this build.
 *
 * A mismatch means another Cline installation replaced the shared Hub with a
 * different build (for example, the CLI was updated while the desktop app
 * kept running). This client can keep talking to it over the compatible wire
 * protocol, but it should prompt the user to update and restart so client
 * and Hub run the same code again.
 *
 * With `requiredCapabilities`, a Hub the build checks accept is also
 * reported when it lacks one of them and is not newer than this client.
 */
export async function checkManagedHubBuildMismatch(
	options: CheckManagedHubBuildOptions = {},
): Promise<ManagedHubBuildMismatchEvent | undefined> {
	const inspection = await inspectManagedHubBuild(options);
	return inspection.status === "mismatch" ? inspection.mismatch : undefined;
}

type ManagedHubBuildInspection =
	| { status: "mismatch"; mismatch: ManagedHubBuildMismatchEvent }
	| { status: "match" }
	| { status: "inconclusive" };

const MATCH: ManagedHubBuildInspection = { status: "match" };
const INCONCLUSIVE: ManagedHubBuildInspection = { status: "inconclusive" };

/**
 * `checkManagedHubBuildMismatch`, telling a Hub confirmed to match apart from
 * one the check could not reach or read.
 */
async function inspectManagedHubBuild(
	options: CheckManagedHubBuildOptions,
): Promise<ManagedHubBuildInspection> {
	const owner = resolveDefaultHubOwnerContext();
	if (isHubStartupLockHeld(owner.discoveryPath)) {
		return INCONCLUSIVE;
	}
	const record = await readHubDiscovery(owner.discoveryPath).catch(
		() => undefined,
	);
	if (!record?.url) {
		return INCONCLUSIVE;
	}
	const healthy = await probeHubServer(record.url).catch(() => undefined);
	if (!healthy?.url) {
		return INCONCLUSIVE;
	}
	const expectedBuildId = resolveHubBuildId();
	const self = resolveHubBuildIdentity();
	const report = (
		reason: ManagedHubBuildMismatchEvent["reason"],
	): ManagedHubBuildMismatchEvent => ({
		url: healthy.url,
		reason,
		hubBuildId: healthy.buildId,
		hubCoreVersion: healthy.coreVersion,
		expectedBuildId,
	});
	const mismatch = (
		event: ManagedHubBuildMismatchEvent,
	): ManagedHubBuildInspection => ({ status: "mismatch", mismatch: event });
	// The build checks accept a Hub of this client's own build or release, but
	// every build of a release can report the same identity, so that Hub can
	// predate a capability this client depends on. A newer Hub is never
	// reported: replacing it would downgrade another install's daemon.
	const inspectCapabilities = async (): Promise<ManagedHubBuildInspection> => {
		const requiredCapabilities = options.requiredCapabilities ?? [];
		if (
			requiredCapabilities.length === 0 ||
			compareHubBuilds(self, healthy) < 0
		) {
			return MATCH;
		}
		const missingCapabilities = await findMissingHubCapabilities(
			record,
			requiredCapabilities,
		);
		if (!missingCapabilities) {
			return INCONCLUSIVE;
		}
		if (missingCapabilities.length === 0) {
			return MATCH;
		}
		return mismatch(
			await withHubSessionActivity(
				{ ...report("missing_capability"), missingCapabilities },
				record.authToken,
			),
		);
	};
	const compatibility = getManagedHubCompatibility(healthy, expectedBuildId);
	if (compatibility.compatible) {
		return await inspectCapabilities();
	}
	// Prompt for mismatches that persist: a newer reusable Hub this client
	// stays attached to, a Hub whose protocol this client cannot speak, or an
	// older Hub that was left running because it is serving sessions. An older
	// idle Hub is retired and replaced automatically, so reporting it here
	// would only flash a stale dialog - the caller filters that case by
	// requiring the mismatch to survive consecutive checks.
	if (compatibility.reason === "unsupported_protocol") {
		return mismatch(report("unsupported_protocol"));
	}
	// Two independently built artifacts of the same release never share a
	// build fingerprint: a CLI and a desktop app cut from different commits
	// at the same core version carry different buildIds and build epochs, so
	// they disagree forever. That disagreement is not user-actionable in
	// either direction - "update" would install nothing newer, and the
	// prompt loops until the next release happens to align the fingerprints.
	// Same core version therefore never prompts about the build; the
	// fingerprint keeps its role in the reuse/retire total order, where its
	// antisymmetry matters, but it does not drive prompts on its own.
	if (
		self.coreVersion &&
		healthy.coreVersion &&
		self.coreVersion === healthy.coreVersion
	) {
		return await inspectCapabilities();
	}
	// Only a Hub this client is strictly newer than gets the "older Hub" copy;
	// that is the case the retire path defers while sessions are live. A newer
	// Hub - or one that carries too little metadata to order, where updating
	// this client is what supplies the missing ordering - is a client-update
	// prompt as before.
	if (compareHubBuilds(self, healthy) > 0) {
		return mismatch(
			await withHubSessionActivity(report("outdated_hub"), record.authToken),
		);
	}
	return mismatch(report("build_mismatch"));
}

export interface WatchManagedHubBuildOptions
	extends CheckManagedHubBuildOptions {
	onMismatch: (event: ManagedHubBuildMismatchEvent) => void;
	/**
	 * Called when a check confirms the Hub matches this build and serves every
	 * required capability: on the first confirmation, and on the first after
	 * each reported mismatch. A check that cannot reach the Hub or read its
	 * status confirms nothing.
	 */
	onResolved?: () => void;
	intervalMs?: number;
}

/**
 * Periodically watch the managed local Hub for a build-identity mismatch and
 * invoke `onMismatch` when another Cline installation has replaced the Hub
 * with a different build, or when the Hub lacks one of
 * `requiredCapabilities`. Fires once per observed Hub build (it will fire
 * again only if the Hub changes to yet another mismatched build after a
 * compatible one was seen, or a different mismatch reason appears).
 * `onResolved` lets the caller withdraw a mismatch it is still showing once
 * the Hub is fixed, however it was fixed.
 *
 * Start this only for managed Hub usage. Hosts configured with an explicit
 * Hub endpoint keep protocol-only compatibility and must not show update
 * prompts, so the watcher refuses to start when `CLINE_HUB_PORT` is set.
 * The first check runs after one interval so app startup (which may itself
 * be replacing a stale Hub) has settled.
 *
 * Returns a stop function.
 */
export function watchManagedHubBuildMismatch(
	options: WatchManagedHubBuildOptions,
): () => void {
	if (isHubDaemonProcess() || process.env.CLINE_HUB_PORT?.trim()) {
		return () => {};
	}
	const intervalMs = options.intervalMs ?? resolveDefaultWatchIntervalMs();
	let notifiedKey: string | undefined;
	let pendingKey: string | undefined;
	// Starts set because the caller may hold a mismatch from its own check
	// that this watcher never reported.
	let callerMayHoldMismatch = true;
	let checking = false;
	const timer = setInterval(() => {
		if (checking) {
			return;
		}
		checking = true;
		void inspectManagedHubBuild({
			requiredCapabilities: options.requiredCapabilities,
		})
			.then((inspection) => {
				if (inspection.status !== "mismatch") {
					notifiedKey = undefined;
					pendingKey = undefined;
					if (inspection.status === "match" && callerMayHoldMismatch) {
						callerMayHoldMismatch = false;
						options.onResolved?.();
					}
					return;
				}
				const { mismatch } = inspection;
				const key = `${mismatch.reason}:${mismatch.hubBuildId ?? ""}`;
				if (key === notifiedKey) {
					return;
				}
				// An older Hub is normally retired and replaced within a moment
				// of being observed. Only report one that is still there on the
				// next check, which means it was deliberately left running.
				if (mismatch.reason === "outdated_hub" && pendingKey !== key) {
					pendingKey = key;
					return;
				}
				pendingKey = undefined;
				notifiedKey = key;
				callerMayHoldMismatch = true;
				options.onMismatch(mismatch);
			})
			.catch(() => undefined)
			.finally(() => {
				checking = false;
			});
	}, intervalMs);
	timer.unref?.();
	return () => {
		clearInterval(timer);
	};
}
