import { useSyncExternalStore } from "react";
import {
	fetchComposioStatus,
	getComposioStatusSnapshot,
	getServerComposioStatusSnapshot,
	subscribeComposioStatus,
} from "./composio";

async function refresh() {
	// The shared snapshot publishes request failures to every consumer.
	await fetchComposioStatus({ refresh: true }).catch(() => {});
}

/** Subscribe to connector data without copying its loading/error state into a view. */
export function useComposioStatus() {
	return {
		...useSyncExternalStore(
			subscribeComposioStatus,
			getComposioStatusSnapshot,
			getServerComposioStatusSnapshot,
		),
		refresh,
	};
}
