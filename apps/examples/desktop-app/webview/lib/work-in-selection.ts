export const WORK_IN_STORAGE_KEY = "cline.code.work-in.v1";

/** Where a new task runs. "worktree" checks out a fresh git worktree first. */
export type WorkIn = "local" | "worktree";

/**
 * Every delete confirmation shows this for a session that ran in a task
 * worktree, since deleting the session force-removes the worktree too.
 */
export const TASK_WORKTREE_DELETE_WARNING =
	"This session ran in its own git worktree. Deleting it also removes that worktree and its generated branch, including any uncommitted changes in it.";

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
