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
	activeCloudCommands?: number;
	activeProviderMutations?: number;
	activeMcpRequests?: number;
};

/** Work the Hub runs without an attached session, and how to name it. */
const SESSIONLESS_WORK = [
	["activePluginRequests", "a plugin command", "plugin commands"],
	["activeCloudCommands", "a cloud session command", "cloud session commands"],
	[
		"activeProviderMutations",
		"a provider settings change",
		"provider settings changes",
	],
	["activeMcpRequests", "an MCP server request", "MCP server requests"],
] as const;

export function hubHasNothingToInterrupt(
	activity: HubSessionActivity | null,
): boolean {
	return (
		activity?.activeSessionCount === 0 &&
		SESSIONLESS_WORK.every(([key]) => !activity[key])
	);
}

function counted(count: number, one: string, many: string): string {
	return count === 1 ? one : `${count} ${many}`;
}

function listed(items: string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
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
	const running = SESSIONLESS_WORK.flatMap(([key, one, many]) => {
		const count = activity?.[key] ?? 0;
		return count > 0 ? [{ count, named: counted(count, one, many) }] : [];
	});
	const total = running.reduce((sum, work) => sum + work.count, 0);
	if (sessions === 0 && total > 0) {
		return `The Hub is running ${listed(running.map((work) => work.named))}. Restarting interrupts ${total === 1 ? "it" : "them"}.`;
	}
	if (typeof sessions !== "number" || sessions <= 0) {
		return `Cline couldn't check what the Hub is serving. ${HUB_RESTART_COST}`;
	}
	return `The Hub is serving ${describeOutdatedHubSessions(activity ?? {})}, including any in this app. Restarting interrupts their work in progress.`;
}
