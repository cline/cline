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

// Shared presentation and telemetry use the same status precedence.
export {
	getAgentPullRequestMergeStatus as getMergeStatus,
	summarizeAgentPullRequestChecks as summarizeChecks,
} from "@cline/ui";
