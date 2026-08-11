import { existsSync } from "node:fs";
import { isHubDaemonProcess, resolveClineBuildEnv } from "@cline/shared";
import {
	getManagedHubCompatibility,
	type HubOwnerContext,
	isManagedHubReusable,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
} from "../discovery";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";

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
	/** Why this client should update: the running Hub is a newer build this
	 * client stays attached to, or it speaks an unsupported protocol. */
	reason: "unsupported_protocol" | "build_mismatch";
	/** Build identity reported by the running Hub, when it reports one. */
	hubBuildId?: string;
	/** Core package version reported by the running Hub. */
	hubCoreVersion?: string;
	/** Build identity this client expects a managed Hub to match. */
	expectedBuildId: string;
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
	// Prompt only for mismatches that persist and that updating this client
	// resolves: a newer reusable Hub this client stays attached to, or a Hub
	// whose protocol this client cannot speak at all. Older or unordered
	// builds are retired and replaced automatically, so prompting would only
	// flash a stale dialog.
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
	if (
		compatibility.reason === "build_mismatch" &&
		isManagedHubReusable(healthy, { expectedBuildId })
	) {
		return report("build_mismatch");
	}
	return undefined;
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
					return;
				}
				const key = `${mismatch.reason}:${mismatch.hubBuildId ?? ""}`;
				if (key === notifiedKey) {
					return;
				}
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
