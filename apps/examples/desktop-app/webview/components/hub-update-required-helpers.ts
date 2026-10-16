import { describeOutdatedHubSessions } from "@cline/shared/browser";
import type { AppUpdateStatus } from "@/hooks/use-app-update";

export type HubUpdateRestartDecision =
	| { action: "restart" }
	| { action: "stay"; hint: string };

export type HubBuildMismatchPayload = {
	hubBuildId?: string;
	hubCoreVersion?: string;
	reason?: string;
	activeSessionCount?: number;
	participantClientCount?: number;
	missingCapabilities?: string[];
};

export function hubMismatchKeyOf(payload: HubBuildMismatchPayload): string {
	return `${payload.reason ?? ""}:${payload.hubBuildId ?? ""}`;
}

/** Generous deadline: drain wait + graceful retire + fresh daemon startup. */
export const HUB_UPGRADE_TIMEOUT_MS = 60_000;

/**
 * Whether a hub build mismatch may interrupt with a modal at all.
 *
 * - `unsupported_protocol` and `outdated_hub` always may: the first means
 *   the app cannot talk to the Hub, the second is the blocking
 *   replace-or-quit decision.
 * - `build_mismatch` may only once an app update is actually staged. A
 *   newer Hub is advisory while the wire protocol still works, and without
 *   a staged update the modal's only exit is "no update available yet",
 *   which loops on every launch and webview reconnect until a release
 *   ships - so it stays silent until it can offer a real action.
 * - `missing_capability` never does: the Hub is not newer than this app and
 *   everything but plugin suggestions works, so the non-blocking
 *   HubCapabilityNotice offers the restart instead.
 */
export function shouldShowHubMismatchDialog(
	reason: string | undefined,
	updateState: AppUpdateStatus["state"] | undefined,
): boolean {
	if (reason === "unsupported_protocol" || reason === "outdated_hub") {
		return true;
	}
	if (reason === "missing_capability") {
		return false;
	}
	return updateState === "ready";
}

/**
 * Only the advisory `build_mismatch` dismissal may persist across webview
 * mounts and app relaunches. An `unsupported_protocol` Hub leaves hub-backed
 * features broken, so that warning must return on every reconnect and
 * relaunch - its "Later" lasts only for the current mount. Applied on both
 * write and read, so a key persisted by any other path is ignored too.
 * (Mismatch keys are `${reason}:${hubBuildId}`.)
 */
export function isPersistableHubMismatchKey(key: string | null): key is string {
	return typeof key === "string" && key.startsWith("build_mismatch:");
}

/**
 * "Not now" on the plugin suggestions notice lasts until the app quits.
 * Every build of a release reports the same Hub identity, so a lasting
 * dismissal would also hide the notice for every later Hub of that release
 * without the capability, and nothing else offers the restart.
 */
const DISMISSED_CAPABILITY_NOTICE_STORAGE_KEY =
	"cline.hub-capability-notice-dismissed";

export function readHubCapabilityNoticeDismissal(): string | null {
	try {
		return sessionStorage.getItem(DISMISSED_CAPABILITY_NOTICE_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function persistHubCapabilityNoticeDismissal(key: string): void {
	try {
		sessionStorage.setItem(DISMISSED_CAPABILITY_NOTICE_STORAGE_KEY, key);
	} catch {
		// Best effort: without storage the dismissal lasts this mount only.
	}
}

/**
 * What a dismissal becomes when the sidecar delivers a mismatch again - it
 * replays the pending mismatch on every webview (re)connection, including
 * in-place transport reconnects where the dialog never remounts. A reason
 * whose dismissal may not outlive the moment (`unsupported_protocol`: the
 * app cannot talk to the Hub) drops its matching in-memory "Later" so the
 * warning reopens on the replay; the advisory `build_mismatch` dismissal
 * stands. An unrelated dismissed key is kept either way.
 */
export function retainDismissalForIncomingMismatch(
	previousDismissedKey: string | null,
	incomingKey: string,
): string | null {
	if (
		previousDismissedKey === incomingKey &&
		!isPersistableHubMismatchKey(incomingKey)
	) {
		return null;
	}
	return previousDismissedKey;
}

/** Live sessions on the Hub, read when the person asks to restart it. */
export type HubSessionActivity = {
	activeSessionCount?: number;
	participantClientCount?: number;
};

/** Said before any reading: the restart's cost does not depend on one. */
export const HUB_RESTART_COST =
	"Restarting interrupts any work in progress in Cline apps that use the Hub, including this one.";

/**
 * The confirmation a forced Hub restart owes the person, from the reading
 * taken when they asked. The count includes this app's own chats.
 */
export function describeHubRestartInterruption(
	activity: HubSessionActivity | null,
): string {
	const sessions = activity?.activeSessionCount;
	if (typeof sessions !== "number" || sessions <= 0) {
		return `Cline couldn't check what the Hub is serving. ${HUB_RESTART_COST}`;
	}
	return `The Hub is serving ${describeOutdatedHubSessions(activity ?? {})}, including any in this app. Restarting interrupts their work in progress.`;
}

/**
 * Decide what "Update and restart" should do after an on-demand updater
 * check. Restart only when an update is actually staged - relaunching the
 * same version would bring the mismatch dialog straight back without
 * restoring build parity with the Hub.
 */
export function resolveHubUpdateRestartDecision(
	status: Pick<AppUpdateStatus, "state" | "error"> | null,
): HubUpdateRestartDecision {
	if (status?.state === "ready") {
		return { action: "restart" };
	}
	if (status?.state === "error") {
		return {
			action: "stay",
			hint: status.error
				? `The update check failed: ${status.error}`
				: "The update check failed. Try again in a moment.",
		};
	}
	return {
		action: "stay",
		hint: "No app update is available to download yet. You can keep working - Cline stays connected to the updated Hub - and try again later.",
	};
}
