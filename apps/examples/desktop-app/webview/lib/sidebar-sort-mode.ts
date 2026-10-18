export type SidebarSortMode = "time" | "project";

export const SIDEBAR_SORT_MODE_STORAGE_KEY = "cline.code.sidebar-sort.v1";

type SortModeStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): SortModeStorage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		// Storage access can throw in hardened/private browsing contexts.
		return undefined;
	}
}

/**
 * The sidebar sort preference is per-client UI state, so it lives in
 * localStorage alongside the other `cline.code.*` selections. Unknown or
 * unreadable values fall back to the chronological default.
 */
export function readSidebarSortMode(
	storage: SortModeStorage | undefined = browserStorage(),
): SidebarSortMode {
	try {
		return storage?.getItem(SIDEBAR_SORT_MODE_STORAGE_KEY) === "project"
			? "project"
			: "time";
	} catch {
		return "time";
	}
}

export function writeSidebarSortMode(
	mode: SidebarSortMode,
	storage: SortModeStorage | undefined = browserStorage(),
): void {
	try {
		storage?.setItem(SIDEBAR_SORT_MODE_STORAGE_KEY, mode);
	} catch {
		// A failed write must not break the toggle; the in-memory state still
		// reflects the user's choice for this launch.
	}
}
