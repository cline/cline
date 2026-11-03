export const WORK_IN_STORAGE_KEY = "cline.code.work-in.v1";

/** Where a new task runs. "worktree" checks out a fresh git worktree first. */
export type WorkIn = "local" | "worktree";

/**
 * Every delete confirmation shows this for a session that ran in a task
 * worktree, since deleting the session force-removes the worktree too.
 */
export const TASK_WORKTREE_DELETE_WARNING =
	"This session ran in its own git worktree. Deleting it also removes that worktree and its generated branch, including any uncommitted changes in it.";

/**
 * "Work in" only matters for the prompt that starts a brand-new thread;
 * later prompts (and prompts into a reopened session) stay where they are.
 * Only accepted conversation counts: a failed first launch leaves an error
 * message in the transcript, and the retried prompt must still get its
 * worktree.
 */
export function startsNewThread(
	sessionId: string | null | undefined,
	messages: ReadonlyArray<{ role: string }>,
): boolean {
	return (
		!sessionId &&
		!messages.some(
			(message) => message.role === "user" || message.role === "assistant",
		)
	);
}

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
