import type { AppUpdateStatus } from "@/hooks/use-app-update";

export type HubUpdateRestartDecision =
	| { action: "restart" }
	| { action: "stay"; hint: string };

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
