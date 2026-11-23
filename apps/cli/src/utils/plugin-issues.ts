import { formatSessionPluginIssue } from "@cline/core";
import type { SessionPluginIssue } from "@cline/shared";

/**
 * One warning line per plugin the session asked for but could not load.
 * Plugins the user turned off (settings or session policy) are not warnings.
 */
export function formatPluginIssueWarnings(
	issues: ReadonlyArray<SessionPluginIssue> | undefined,
): string[] {
	return (issues ?? [])
		.filter((issue) => issue.state === "failed")
		.map(formatSessionPluginIssue);
}
