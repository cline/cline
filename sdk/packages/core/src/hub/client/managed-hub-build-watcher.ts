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
	 */
	reason: "unsupported_protocol" | "build_mismatch" | "outdated_hub";
	/** Build identity reported by the running Hub, when it reports one. */
	hubBuildId?: string;
	/** Core package version reported by the running Hub. */
	hubCoreVersion?: string;
	/** Build identity this client expects a managed Hub to match. */
	expectedBuildId: string;
	/**
	 * Sessions with live participants on the Hub (best-effort, `outdated_hub`
	 * only): the work that replacing the Hub would interrupt. Unset when the
	 * Hub cannot answer the query.
	 */
	activeSessionCount?: number;
	/** Distinct clients attached to those sessions (best-effort, `outdated_hub` only). */
	participantClientCount?: number;
}

/**
 * Best-effort enrichment for the `outdated_hub` case: how much live work the
 * older Hub is serving, so surfaces can say "updating now interrupts N
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
 */
export async function checkManagedHubBuildMismatch(): Promise<
	ManagedHubBuildMismatchEvent | undefined
> {
	const owner = resolveDefaultHubOwnerContext();
	if (isHubStartupLockHeld(owner.discoveryPath)) {
		return undefined;
	}
	const record = await readHubDiscovery(owner.discoveryPath).catch(
		() => undefined,
	);
	if (!record?.url) {
		return undefined;
	}
	const healthy = await probeHubServer(record.url).catch(() => undefined);
	if (!healthy?.url) {
		return undefined;
	}
	const expectedBuildId = resolveHubBuildId();
	const compatibility = getManagedHubCompatibility(healthy, expectedBuildId);
	if (compatibility.compatible) {
		return undefined;
	}
	// Prompt for mismatches that persist: a newer reusable Hub this client
	// stays attached to, a Hub whose protocol this client cannot speak, or an
	// older Hub that was left running because it is serving sessions. An older
	// idle Hub is retired and replaced automatically, so reporting it here
	// would only flash a stale dialog - the caller filters that case by
	// requiring the mismatch to survive consecutive checks.
	const report = (
		reason: ManagedHubBuildMismatchEvent["reason"],
	): ManagedHubBuildMismatchEvent => ({
		url: healthy.url,
		reason,
		hubBuildId: healthy.buildId,
		hubCoreVersion: healthy.coreVersion,
		expectedBuildId,
	});
	if (compatibility.reason === "unsupported_protocol") {
		return report("unsupported_protocol");
	}
	// Two independently built artifacts of the same release never share a
	// build fingerprint: a CLI and a desktop app cut from different commits
	// at the same core version carry different buildIds and build epochs, so
	// they disagree forever. That disagreement is not user-actionable in
	// either direction - "update" would install nothing newer, and the
	// prompt loops until the next release happens to align the fingerprints.
	// Same core version therefore never prompts; the fingerprint keeps its
	// role in the reuse/retire total order, where its antisymmetry matters,
	// but it does not drive prompts on its own.
	const self = resolveHubBuildIdentity();
	if (
		self.coreVersion &&
		healthy.coreVersion &&
		self.coreVersion === healthy.coreVersion
	) {
		return undefined;
	}
	// Only a Hub this client is strictly newer than gets the "older Hub" copy;
	// that is the case the retire path defers while sessions are live. A newer
	// Hub - or one that carries too little metadata to order, where updating
	// this client is what supplies the missing ordering - is a client-update
	// prompt as before.
	if (compareHubBuilds(self, healthy) > 0) {
		return await withHubSessionActivity(
			report("outdated_hub"),
			record.authToken,
		);
	}
	return report("build_mismatch");
}

export interface WatchManagedHubBuildOptions {
	onMismatch: (event: ManagedHubBuildMismatchEvent) => void;
	intervalMs?: number;
}

/**
 * Periodically watch the managed local Hub for a build-identity mismatch and
 * invoke `onMismatch` when another Cline installation has replaced the Hub
 * with a different build. Fires once per observed Hub build (it will fire
 * again only if the Hub changes to yet another mismatched build after a
 * compatible one was seen, or a different mismatch reason appears).
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
	let checking = false;
	const timer = setInterval(() => {
		if (checking) {
			return;
		}
		checking = true;
		void checkManagedHubBuildMismatch()
			.then((mismatch) => {
				if (!mismatch) {
					notifiedKey = undefined;
					pendingKey = undefined;
					return;
				}
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
