import type { FactoryTaskConfig } from "@cline/shared";
import { findFactoryIssueUrl } from "./factory-issue-url";

type FactorySourceIssue = NonNullable<FactoryTaskConfig["sourceIssue"]>;

/** Sent with the first prompt of a Factory intake chat; the sidecar adds the policy. */
export type FactoryIntakeStart = { sourceIssue?: FactorySourceIssue };

export type ImportedFactoryIssue = {
	title: string;
	description: string;
	source: FactorySourceIssue;
	existingTaskId?: string;
};

export type PreparedFactoryIntake =
	| { kind: "existing"; taskId: string }
	| { kind: "start"; prompt: string; intake: FactoryIntakeStart };

/**
 * An issue URL in the request is read once through the existing importer
 * before the intake session starts, so the card's source comes from the
 * importer rather than from the agent. An issue already tracked as a card
 * opens that card instead of starting a conversation.
 */
export async function prepareFactoryIntake(input: {
	prompt: string;
	workspaceRoot: string;
	hasAttachments?: boolean;
	importIssue: (args: {
		url: string;
		cwd: string;
	}) => Promise<ImportedFactoryIssue>;
}): Promise<PreparedFactoryIntake> {
	const url = findFactoryIssueUrl(input.prompt);
	const cwd = input.workspaceRoot.trim();
	if (!url || !cwd || input.hasAttachments)
		return { kind: "start", prompt: input.prompt, intake: {} };
	const issue = await input.importIssue({ url, cwd });
	if (issue.existingTaskId)
		return { kind: "existing", taskId: issue.existingTaskId };
	return {
		kind: "start",
		prompt:
			`${input.prompt}\n\nImported issue: ${issue.title}\n${issue.source.url}\n\n${issue.description}`.trimEnd(),
		intake: { sourceIssue: issue.source },
	};
}
