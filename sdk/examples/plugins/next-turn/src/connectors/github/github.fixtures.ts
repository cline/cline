import { defaultSettings, type Settings } from "../../settings/settings";
import type { Call } from "../connectors.fixtures";

const PR_LIST = JSON.stringify([
	{
		number: 7,
		state: "CLOSED",
		headRepositoryOwner: { login: "cline" },
		headRepository: { name: "router" },
	},
	{
		number: 9,
		state: "OPEN",
		headRepositoryOwner: { login: "fork" },
		headRepository: { name: "router" },
	},
	{
		number: 12,
		state: "OPEN",
		headRepositoryOwner: { login: "Cline" },
		headRepository: { name: "router" },
	},
]);
export const PR_VIEW = JSON.stringify({
	number: 12,
	title: "Return 405 for wrong methods",
	url: "https://github.com/cline/router/pull/12",
	state: "OPEN",
	isDraft: false,
	mergeable: "MERGEABLE",
	statusCheckRollup: [
		{
			__typename: "CheckRun",
			name: "lint",
			status: "COMPLETED",
			conclusion: "FAILURE",
		},
		{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS" },
		{ __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
	],
});
const THREADS = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				reviewThreads: {
					nodes: [
						{
							isResolved: false,
							isOutdated: false,
							path: "src/routes.ts",
							comments: {
								nodes: [
									{ author: { login: "ana" }, body: "PRIVATE REVIEW TEXT" },
								],
							},
						},
						{
							isResolved: true,
							isOutdated: false,
							path: "src/old.ts",
							comments: { nodes: [{ author: { login: "bo" } }] },
						},
						{
							isResolved: false,
							isOutdated: true,
							path: "src/stale.ts",
							comments: { nodes: [{ author: { login: "cy" } }] },
						},
					],
				},
			},
		},
	},
});

export function ghHandler({ args }: Call): string {
	const joined = args.join(" ");
	if (joined.startsWith("auth status")) return "";
	if (joined.startsWith("pr list")) return PR_LIST;
	if (joined.startsWith("pr view")) return PR_VIEW;
	if (joined.startsWith("api graphql")) return THREADS;
	if (joined.startsWith("repo view"))
		return JSON.stringify({ defaultBranchRef: { name: "main" } });
	if (joined.startsWith("run list")) {
		return JSON.stringify([
			{ workflowName: "CI", status: "completed", conclusion: "failure" },
			{ workflowName: "CI", status: "completed", conclusion: "success" },
			{ workflowName: "Docs", status: "in_progress" },
			{ workflowName: "Lint", status: "completed", conclusion: "success" },
		]);
	}
	throw new Error(`unexpected gh ${joined}`);
}

export function settingsWith(
	role: "off" | "mention" | "read",
	scopes: string[] = [],
): Settings {
	const settings = defaultSettings();
	settings.connectors.github = { role, scopes };
	return settings;
}
