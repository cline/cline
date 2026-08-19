import type { AppUpdateStatus } from "@/hooks/use-app-update";

export type HubUpdateRestartDecision =
	| { action: "restart" }
	| { action: "stay"; hint: string };

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
