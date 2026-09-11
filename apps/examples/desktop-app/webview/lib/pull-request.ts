export type PullRequestCheck = {
	name: string;
	state: "pending" | "success" | "failure" | "skipped";
	url?: string;
};

export type PullRequestStatus = {
	repository: string;
	branch: string;
	createUrl: string | null;
	pullRequest: {
		number: number;
		title: string;
		url: string;
		state: "OPEN" | "CLOSED" | "MERGED";
		isDraft: boolean;
		mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
		mergeStateStatus: string;
		additions: number;
		deletions: number;
		checks: PullRequestCheck[];
	} | null;
};

export function summarizeChecks(
	checks: PullRequestCheck[],
): PullRequestCheck["state"] | "none" {
	if (!checks.length) return "none";
	if (checks.some((check) => check.state === "failure")) return "failure";
	if (checks.some((check) => check.state === "pending")) return "pending";
	if (checks.every((check) => check.state === "skipped")) return "skipped";
	return "success";
}

export type MergeStatus = {
	label: string;
	tone: "merged" | "failure" | "warning" | "neutral" | "success";
};

export function getMergeStatus(
	pr: NonNullable<PullRequestStatus["pullRequest"]>,
): MergeStatus {
	if (pr.state === "MERGED") return { label: "Merged", tone: "merged" };
	if (pr.state === "CLOSED") return { label: "Closed", tone: "failure" };
	if (pr.isDraft) return { label: "Draft", tone: "neutral" };
	if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
		return { label: "Conflicts", tone: "failure" };
	}
	if (pr.mergeStateStatus === "BLOCKED")
		return { label: "Blocked", tone: "warning" };
	if (pr.mergeStateStatus === "BEHIND")
		return { label: "Behind base", tone: "warning" };
	if (pr.mergeStateStatus === "UNSTABLE")
		return { label: "Checks failing", tone: "failure" };
	if (pr.mergeable === "UNKNOWN")
		return { label: "Merge status pending", tone: "neutral" };
	if (pr.mergeStateStatus === "CLEAN")
		return { label: "Ready to merge", tone: "success" };
	// Absence of conflicts alone does not mean the PR is ready to merge.
	if (pr.mergeable === "MERGEABLE")
		return { label: "No conflicts", tone: "neutral" };
	return { label: "Merge status pending", tone: "neutral" };
}
