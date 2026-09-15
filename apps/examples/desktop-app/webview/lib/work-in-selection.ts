export const WORK_IN_STORAGE_KEY = "cline.code.work-in.v1";

/** Where a new task runs. "worktree" checks out a fresh git worktree first. */
export type WorkIn = "local" | "worktree";

export function readWorkInFromWindow(): WorkIn {
	if (typeof window === "undefined") {
		return "local";
	}
	return window.localStorage.getItem(WORK_IN_STORAGE_KEY) === "worktree"
		? "worktree"
		: "local";
}

export function writeWorkInToWindow(value: WorkIn): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(WORK_IN_STORAGE_KEY, value);
}
