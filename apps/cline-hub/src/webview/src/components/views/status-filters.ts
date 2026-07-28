/**
 * Filter logic for the Status Hub view, kept out of the component so it can be
 * tested under the node environment the webview suite runs in.
 *
 * A live `status.updated` broadcast is not necessarily part of the view being
 * shown: the server applied the filters to the page, but the broadcast bypasses
 * that path entirely. The same predicate has to run client-side before a live
 * row is prepended, or the list shows rows that contradict its own filters.
 */

import type { StatusState, StatusUpdate } from "@cline/shared";

export interface StatusFilters {
	stateFilter: StatusState[];
	agentFilter: string | null;
	search: string;
}

export const EMPTY_STATUS_FILTERS: StatusFilters = {
	stateFilter: [],
	agentFilter: null,
	search: "",
};

/** True when any filter narrows the view away from "everything". */
export function hasActiveFilters(filters: StatusFilters): boolean {
	return (
		filters.stateFilter.length > 0 ||
		filters.agentFilter !== null ||
		filters.search !== ""
	);
}

/** Mirrors the server-side query so a live row is held to the same test. */
export function matchesStatusFilters(
	update: StatusUpdate,
	filters: StatusFilters,
): boolean {
	if (
		filters.stateFilter.length > 0 &&
		!filters.stateFilter.includes(update.state)
	) {
		return false;
	}
	if (filters.agentFilter && update.agentId !== filters.agentFilter) {
		return false;
	}
	if (filters.search) {
		const haystack =
			`${update.headline} ${update.detail ?? ""}`.toLowerCase();
		if (!haystack.includes(filters.search.toLowerCase())) return false;
	}
	return true;
}

/**
 * What a board section heading should claim.
 *
 * Unfiltered, the whole-table count is the honest number — a board that says
 * "3 blocked" when 40 are blocked is worse than no board. Filtered, the rows
 * below the heading are a subset the summary knows nothing about, so the
 * heading has to describe them instead or it contradicts what is on screen.
 */
export function sectionHeadingCount(
	rowCount: number,
	summaryCount: number | undefined,
	filtersActive: boolean,
): number {
	if (filtersActive) return rowCount;
	return summaryCount ?? rowCount;
}
