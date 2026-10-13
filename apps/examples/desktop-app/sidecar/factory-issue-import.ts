import type { FactoryTaskConfig } from "@cline/shared";
import { z } from "zod";
import { runCommand } from "./pull-request";

const issueText = z.string().trim().min(1);
const githubIssueSchema = z.object({
	id: issueText,
	title: issueText,
	body: z.string(),
	url: z.string().url(),
});
const linearResponseSchema = z.object({
	data: z
		.object({
			issue: z
				.object({
					id: issueText,
					title: issueText,
					description: z.string().nullable(),
					url: z.string().url(),
				})
				.nullable(),
		})
		.nullish(),
	errors: z.array(z.unknown()).optional(),
});

export type FactoryImportedIssue = {
	title: string;
	description: string;
	source: NonNullable<FactoryTaskConfig["sourceIssue"]>;
};

function parseIssueUrl(input: string) {
	const invalid = () => new Error("Enter a GitHub or Linear issue URL.");
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw invalid();
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) {
		throw invalid();
	}
	if (url.hostname === "github.com") {
		const match = /^\/([\w.-]+)\/([\w.-]+)\/issues\/([1-9]\d*)\/?$/.exec(
			url.pathname,
		);
		if (match) {
			return {
				provider: "github" as const,
				url: `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}`,
			};
		}
	}
	if (url.hostname === "linear.app") {
		const match =
			/^\/([\w-]+)\/issue\/([a-z\d]+-[1-9]\d*)(?:\/[^/]+)?\/?$/i.exec(
				url.pathname,
			);
		if (match) {
			return {
				provider: "linear" as const,
				workspace: match[1].toLowerCase(),
				identifier: match[2].toUpperCase(),
				url: `https://linear.app/${match[1].toLowerCase()}/issue/${match[2].toUpperCase()}`,
			};
		}
	}
	throw invalid();
}

export async function readFactoryIssue(
	{ url, cwd }: { url: string; cwd: string },
	{
		run = runCommand,
		fetchImpl = fetch,
		env = process.env,
	}: {
		run?: typeof runCommand;
		fetchImpl?: typeof fetch;
		env?: NodeJS.ProcessEnv;
	} = {},
): Promise<FactoryImportedIssue> {
	const source = parseIssueUrl(url);
	if (source.provider === "github") {
		let output: string;
		try {
			output = await run(
				"gh",
				["issue", "view", source.url, "--json", "id,title,body,url"],
				cwd,
			);
		} catch {
			throw new Error(
				"Could not read the GitHub issue. Check the URL and repository access, and sign in with gh auth login.",
			);
		}
		const issue = githubIssueSchema.parse(JSON.parse(output));
		const canonical = parseIssueUrl(issue.url);
		if (canonical.provider !== "github")
			throw new Error("GitHub returned an invalid issue URL.");
		return {
			title: issue.title,
			description: issue.body,
			source: { provider: "github", id: issue.id, url: canonical.url },
		};
	}

	const apiKey = env.LINEAR_API_KEY?.trim();
	const accessToken = env.LINEAR_ACCESS_TOKEN?.trim();
	if (!apiKey && !accessToken) {
		throw new Error(
			"Linear issue import needs LINEAR_API_KEY or LINEAR_ACCESS_TOKEN in the desktop app environment, as used by the Linear connector.",
		);
	}
	let response: Response;
	try {
		response = await fetchImpl("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: apiKey || `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				query:
					"query FactoryIssue($id: String!) { issue(id: $id) { id title description url } }",
				variables: { id: source.identifier },
			}),
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new Error(
			"Could not reach Linear. Check your connection and try again.",
		);
	}
	if (!response.ok) {
		throw new Error(
			`Could not read the Linear issue (HTTP ${response.status}). Check your Linear credentials and issue access.`,
		);
	}
	const result = linearResponseSchema.parse(await response.json());
	if (result.errors?.length || !result.data?.issue) {
		throw new Error(
			"Could not read the Linear issue. Check the URL and access for the configured Linear account.",
		);
	}
	const issue = result.data.issue;
	const canonical = parseIssueUrl(issue.url);
	if (
		canonical.provider !== "linear" ||
		canonical.workspace !== source.workspace ||
		canonical.identifier !== source.identifier
	) {
		throw new Error(
			"The issue belongs to a different Linear workspace. Use credentials for the workspace in the issue URL.",
		);
	}
	return {
		title: issue.title,
		description: issue.description ?? "",
		source: { provider: "linear", id: issue.id, url: canonical.url },
	};
}
