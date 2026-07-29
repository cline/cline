export type DrivecodeDemoHubBootstrap = {
	/** `?demoPlans=1` — use demo teams fixture for the dependency map */
	useDemoTeamsAdapter: boolean;
	/** `?demoShareScreen=1` — mount simulated share-screen Spotlight demo */
	useShareScreenSpotlightDemo: boolean;
	/** `?demoChatFork=1` — mount ChatFork claim→show→promote demo */
	useChatForkDemo: boolean;
	/** `?statusMode=` — initial Status Hub mode */
	initialStatusMode?: "board" | "changelog" | "dependency-map";
};

function toSearchParams(search?: string | URLSearchParams): URLSearchParams {
	if (search instanceof URLSearchParams) {
		return search;
	}
	if (search === undefined) {
		return new URLSearchParams();
	}
	const trimmed = search.startsWith("?") ? search.slice(1) : search;
	return new URLSearchParams(trimmed);
}

/**
 * Read hub demo flags from the URL search string at the composition-root edge.
 * Pass `window.location.search` from the hub App — this helper does not touch
 * the DOM so CLI typecheck stays Node-clean.
 * Product views must not import fixtures directly; use this + the demo adapter.
 */
export function readDrivecodeDemoHubBootstrap(
	search?: string | URLSearchParams,
): DrivecodeDemoHubBootstrap {
	const params = toSearchParams(search);
	const mode = params.get("statusMode")?.trim();
	return {
		useDemoTeamsAdapter: params.get("demoPlans") === "1",
		useShareScreenSpotlightDemo: params.get("demoShareScreen") === "1",
		useChatForkDemo: params.get("demoChatFork") === "1",
		initialStatusMode:
			mode === "board" || mode === "changelog" || mode === "dependency-map"
				? mode
				: undefined,
	};
}
