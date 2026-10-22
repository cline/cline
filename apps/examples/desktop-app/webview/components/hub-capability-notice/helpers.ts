import { describeOutdatedHubSessions } from "@cline/shared/browser";

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

/** Live work on the Hub, read when the person asks to restart it. */
export type HubSessionActivity = {
	activeSessionCount?: number;
	participantClientCount?: number;
	activePluginRequests?: number;
};

export function hubHasNothingToInterrupt(
	activity: HubSessionActivity | null,
): boolean {
	return activity?.activeSessionCount === 0 && !activity.activePluginRequests;
}

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
	const pluginRequests = activity?.activePluginRequests ?? 0;
	if (sessions === 0 && pluginRequests > 0) {
		return pluginRequests === 1
			? "The Hub is running a plugin command. Restarting interrupts it."
			: `The Hub is running ${pluginRequests} plugin commands. Restarting interrupts them.`;
	}
	if (typeof sessions !== "number" || sessions <= 0) {
		return `Cline couldn't check what the Hub is serving. ${HUB_RESTART_COST}`;
	}
	return `The Hub is serving ${describeOutdatedHubSessions(activity ?? {})}, including any in this app. Restarting interrupts their work in progress.`;
}
