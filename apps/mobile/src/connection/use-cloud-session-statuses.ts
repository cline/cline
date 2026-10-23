import { useSyncExternalStore } from "react";
import { cloudLaunches } from "./cloud-launches";

/** Only observed live statuses; sidebar rendering never opens a connection. */
export function useCloudSessionStatuses() {
	return useSyncExternalStore(
		cloudLaunches.subscribe,
		cloudLaunches.getStatuses,
		cloudLaunches.getStatuses,
	);
}

export function useUnreadCloudSessions() {
	return useSyncExternalStore(
		cloudLaunches.subscribe,
		cloudLaunches.getUnread,
		cloudLaunches.getUnread,
	);
}
