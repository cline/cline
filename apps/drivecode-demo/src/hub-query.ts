export type DrivecodeDemoHubBootstrap = {
	/** `?demoPlans=1` — use demo teams fixture for the dependency map */
	useDemoTeamsAdapter: boolean;
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
 * Product views must not import fixtures directly; use this + the demo adapter.
 */
export function readDrivecodeDemoHubBootstrap(
	search?: string | URLSearchParams,
): DrivecodeDemoHubBootstrap {
	const params = toSearchParams(search);
	const mode = params.get("statusMode")?.trim();
	return {
		useDemoTeamsAdapter: params.get("demoPlans") === "1",
		initialStatusMode:
			mode === "board" || mode === "changelog" || mode === "dependency-map"
				? mode
				: undefined,
	};
}
