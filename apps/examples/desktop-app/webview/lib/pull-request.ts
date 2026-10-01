export type { PullRequestCheck, PullRequestStatus } from "@cline/shared";

// Shared presentation and telemetry use the same status precedence.
export {
	getAgentPullRequestMergeStatus as getMergeStatus,
	summarizeAgentPullRequestChecks as summarizeChecks,
} from "@cline/ui";
