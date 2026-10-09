import type { CloudSessionRecord } from "./api";

/** How GitHub access works inside every cloud sandbox. */
export const CLOUD_SESSION_SYSTEM_PROMPT =
	"IMPORTANT: GitHub authentication is handled automatically by the infrastructure. " +
	"An egress proxy transparently injects credentials into all GitHub traffic. " +
	"You do NOT need to set up, configure, or manage any tokens, API keys, or credentials, " +
	"and you must never run `gh auth login` or attempt to authenticate manually. " +
	"The GitHub CLI (`gh`) is installed and already authenticated — prefer it for GitHub work " +
	"(`gh pr create`, `gh pr diff`, `gh issue list`, `gh api`, ...). " +
	"`git` push and pull are authenticated the same way. " +
	"Simply run the commands normally — credentials are injected transparently.";

type CloudSessionPromptRecord = Pick<
	CloudSessionRecord,
	"id" | "sandboxType" | "metadata"
>;

/** The branch a cloud task commits to, named after its task id. */
export function cloudSessionWorkBranch(
	record: Pick<CloudSessionRecord, "id" | "metadata">,
): string {
	return `cline/${(record.metadata.taskId?.trim() || record.id).slice(-8).toLowerCase()}`;
}

export function isResumableCloudSession(
	record: Pick<CloudSessionRecord, "sandboxType" | "metadata">,
): boolean {
	return (
		record.sandboxType === "resumable" ||
		record.metadata.sandboxType === "resumable"
	);
}

/**
 * The system prompt a new cloud task starts with: GitHub access plus the
 * branch discipline that keeps the agent's work off the default branch. A
 * standard sandbox is temporary, so its agent also pushes work as it goes.
 */
export function buildCloudSessionSystemPrompt(
	record: CloudSessionPromptRecord,
): string {
	const branch = cloudSessionWorkBranch(record);
	return (
		`${CLOUD_SESSION_SYSTEM_PROMPT}\n\n` +
		`Do all work for this task on the branch \`${branch}\`: create it from the current checkout before your first change ` +
		"(or check it out if it already exists), and never commit directly to the default branch. " +
		(isResumableCloudSession(record)
			? "Commit and push only when the user asks. "
			: "SAVE YOUR WORK: This sandbox is temporary. Push your progress to origin so it remains available outside the sandbox. " +
				`The branch \`${branch}\` is a backup of your work-in-progress, not a finished deliverable, so commit to it freely even when the work is incomplete. ` +
				"Commit regularly as you complete meaningful steps, using clear, descriptive messages. " +
				`The first time you commit, push the branch with \`git push -u origin ${branch}\`, and push again after each later commit. `) +
		"Do not force-push or amend commits that are already pushed unless the user explicitly asks."
	);
}
