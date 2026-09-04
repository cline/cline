import type { AppUpdateStatus } from "@/hooks/use-app-update";

export type HubUpdateRestartDecision =
	| { action: "restart" }
	| { action: "stay"; hint: string };

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
 */
export function shouldShowHubMismatchDialog(
	reason: string | undefined,
	updateState: AppUpdateStatus["state"] | undefined,
): boolean {
	if (reason === "unsupported_protocol" || reason === "outdated_hub") {
		return true;
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

/**
 * Human phrase for the live work an outdated Hub is serving, used by the
 * blocking "Hub update required" dialog. Falls back to an unquantified
 * phrase when the Hub could not answer the activity query.
 */
export function describeOutdatedHubSessions(counts: {
	activeSessionCount?: number;
	participantClientCount?: number;
}): string {
	const sessions = counts.activeSessionCount;
	if (typeof sessions !== "number" || sessions <= 0) {
		return "active sessions from other Cline clients";
	}
	const sessionsPhrase = `${sessions} active session${sessions === 1 ? "" : "s"}`;
	const clients = counts.participantClientCount;
	if (typeof clients !== "number" || clients <= 0) {
		return sessionsPhrase;
	}
	return `${sessionsPhrase} from ${clients} connected Cline client${clients === 1 ? "" : "s"}`;
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
