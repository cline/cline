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

export function mergeStatusLabel(
	pr: NonNullable<PullRequestStatus["pullRequest"]>,
): string {
	if (pr.state === "MERGED") return "Merged";
	if (pr.state === "CLOSED") return "Closed";
	if (pr.isDraft) return "Draft";
	if (pr.mergeable === "CONFLICTING") return "Conflicts";
	if (pr.mergeStateStatus === "BLOCKED") return "Blocked";
	if (pr.mergeStateStatus === "BEHIND") return "Behind base";
	if (pr.mergeStateStatus === "UNSTABLE") return "Checks failing";
	if (pr.mergeStateStatus === "CLEAN") return "Ready to merge";
	if (pr.mergeable === "MERGEABLE") return "No conflicts";
	return "Merge status pending";
}
