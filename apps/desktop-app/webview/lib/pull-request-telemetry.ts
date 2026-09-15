import { desktopClient } from "./desktop-client";
import {
	getMergeStatus,
	type PullRequestStatus,
	summarizeChecks,
} from "./pull-request";
import type { PullRequestTelemetry } from "./pull-request-telemetry-schema";

/** Click events describe intent; opening GitHub's form does not create a PR. */
export function trackPullRequestEvent(
	action: PullRequestTelemetry["action"],
	data: PullRequestStatus | null,
): void {
	const pr = data?.pullRequest;
	const event: PullRequestTelemetry = {
		action,
		prState: !data
			? "unknown"
			: !pr
				? "none"
				: pr.state === "MERGED"
					? "merged"
					: pr.state === "CLOSED"
						? "closed"
						: pr.isDraft
							? "draft"
							: "open",
		ciState: summarizeChecks(pr?.checks ?? []),
		mergeTone: pr ? getMergeStatus(pr).tone : "neutral",
	};
	// Telemetry must not delay or fail the user's interaction.
	void desktopClient
		.invoke("capture_pull_request_event", event)
		.catch(() => {});
}
