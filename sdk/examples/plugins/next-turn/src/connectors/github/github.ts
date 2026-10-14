import {
	GITHUB_DEFAULT_CI_EVERY_MINUTES,
	GITHUB_NAMES_MAX,
	GITHUB_PR_EVERY_MINUTES,
	GITHUB_REVIEWS_EVERY_MINUTES,
	GITHUB_TITLE_MAX,
} from "../../config";
import { clip } from "../../context/redact";
import type { Facts, SourceEnv, SourceState } from "../../context/source";
import { ageLabel } from "../../context/sources/history";
import type { ClineConnections, McpServer } from "../cline-connections";
import type {
	Access,
	Connector,
	Detection,
	ReadScope,
	Route,
} from "../connector";
import {
	type DefaultCiFact,
	type GhReader,
	githubRepository,
	type PullRequestFact,
	type ReviewFact,
} from "./gh";

/**
 * GitHub, through the connections the person already gave Cline.
 *
 * | Route | Mention | Read |
 * |---|---|---|
 * | `gh`, the sign-in Cline desktop's PR bar uses | yes | yes |
 * | Composio's GitHub toolkit on the Cline account | yes | after upstream ask U4 |
 * | A GitHub MCP server in Cline's settings | yes | through its own MCP row's pinned reads (K3) |
 * | GitHub tools the agent has in this chat | yes | only the agent calls them |
 *
 * Mention gives the planner no GitHub data: suggestions may ask the agent to
 * use the connection ("Check CI on this branch's PR"). Read refreshes the
 * chosen scopes in the background and hands the planner bounded facts with
 * their age; it never runs in a hook.
 */

export const GITHUB_SCOPES: readonly ReadScope[] = [
	{
		id: "pr",
		label: "This branch's PR and checks",
		everyMinutes: GITHUB_PR_EVERY_MINUTES,
		onPush: true,
	},
	{
		id: "reviews",
		label: "Review threads (counts, not text)",
		everyMinutes: GITHUB_REVIEWS_EVERY_MINUTES,
	},
	{
		id: "default-ci",
		label: "Default-branch CI",
		everyMinutes: GITHUB_DEFAULT_CI_EVERY_MINUTES,
	},
];

const MCP_GITHUB = /github/i;
const AGENT_GITHUB_TOOL = /github/i;

export function githubMcpServers(servers: readonly McpServer[]): McpServer[] {
	return servers.filter(
		(server) =>
			!server.disabled &&
			(MCP_GITHUB.test(server.name) || MCP_GITHUB.test(server.target)),
	);
}

export function agentHasGitHubTools(tools: readonly string[]): boolean {
	return tools.some((tool) => AGENT_GITHUB_TOOL.test(tool));
}

export function repositoryOf(env: SourceEnv): string | null {
	for (const remote of env.git?.remotes ?? []) {
		const repository = githubRepository(remote);
		if (repository) return repository;
	}
	return null;
}

/** The Cline connections GitHub can go through here, before this turn's tools are known. */
export function githubRoutes(
	ghSignedIn: boolean,
	connections: ClineConnections,
): Route[] {
	const routes: Route[] = [];
	if (ghSignedIn)
		routes.push({
			id: "gh",
			label: "gh, signed in (the sign-in Cline's PR bar uses)",
			mention: true,
			read: true,
		});
	if (
		connections.composio.some(
			(toolkit) => toolkit.toolkit === "github" && toolkit.connected,
		)
	) {
		routes.push({
			id: "composio",
			label: "Composio, through your Cline account",
			mention: true,
			read: {
				reason:
					"Reading through Composio needs Cline to export its connector tool runner (upstream ask U4)",
			},
		});
	}
	for (const server of githubMcpServers(connections.mcp)) {
		routes.push({
			id: `mcp:${server.name}`,
			label: `MCP server "${server.name}"`,
			mention: true,
			read: {
				reason: `Pin read-only tools on MCP server "${server.name}" to read through it`,
			},
		});
	}
	return routes;
}

type Snapshot = {
	key: string;
	pr?: { fetchedAt: number; value: PullRequestFact | null };
	reviews?: { fetchedAt: number; value: ReviewFact | null };
	defaultCi?: { fetchedAt: number; value: DefaultCiFact | null };
};

function named(names: readonly string[]): string {
	const shown = names.slice(0, GITHUB_NAMES_MAX).join(", ");
	return names.length > GITHUB_NAMES_MAX
		? `${shown} and ${names.length - GITHUB_NAMES_MAX} more`
		: shown;
}

export function prLine(pr: PullRequestFact | null, branch: string): string {
	if (!pr) return `No pull request for ${branch} yet.`;
	const failing = pr.checks
		.filter((check) => check.state === "failure")
		.map((check) => check.name);
	const pending = pr.checks.filter((check) => check.state === "pending").length;
	const passing = pr.checks.filter((check) => check.state === "success").length;
	const checks =
		pr.checks.length === 0
			? "no checks"
			: [
					failing.length > 0
						? `${failing.length} failing (${named(failing)})`
						: "",
					pending > 0 ? `${pending} pending` : "",
					`${passing} passing`,
				]
					.filter(Boolean)
					.join(", ");
	const state =
		pr.isDraft && pr.state === "OPEN" ? "draft" : pr.state.toLowerCase();
	const mergeable =
		pr.mergeable && pr.mergeable !== "UNKNOWN"
			? ` · ${pr.mergeable.toLowerCase()}`
			: "";
	return `PR #${pr.number} "${clip(pr.title, GITHUB_TITLE_MAX)}" · ${state}${mergeable} · checks: ${checks}`;
}

export function reviewLine(reviews: ReviewFact | null): string {
	if (!reviews || reviews.unresolved === 0)
		return "No unresolved review threads.";
	const by =
		reviews.authors.length > 0
			? `, opened by ${named(reviews.authors.map((login) => `@${login}`))}`
			: "";
	const on = reviews.paths.length > 0 ? `, on ${named(reviews.paths)}` : "";
	return `Review threads: ${reviews.unresolved} unresolved${by}${on}.`;
}

export function defaultCiLine(ci: DefaultCiFact | null): string {
	if (!ci) return "Default-branch CI: no runs.";
	if (ci.failing.length > 0)
		return `Default branch (${ci.branch}) CI: failing in ${named(ci.failing)}.`;
	if (ci.pending.length > 0)
		return `Default branch (${ci.branch}) CI: running ${named(ci.pending)}.`;
	return `Default branch (${ci.branch}) CI: passing.`;
}

export type GitHubConnectorDeps = {
	gh: GhReader;
	connections: () => Promise<ClineConnections>;
	access: () => Access;
	now?: () => number;
};

export class GitHubConnector implements Connector {
	readonly id = "github";
	readonly kind = "github" as const;
	readonly tier = "T3" as const;
	readonly scopes = GITHUB_SCOPES;
	private detection: Detection | undefined;
	private snapshot: Snapshot | undefined;

	constructor(private readonly deps: GitHubConnectorDeps) {}

	private now(): number {
		return (this.deps.now ?? Date.now)();
	}

	/** Background: which Cline routes exist. The probe answers from the last detection. */
	async detect(env: SourceEnv): Promise<Detection> {
		const cwd = env.workspaceRoot ?? env.cwd ?? ".";
		const [signedIn, connections] = await Promise.all([
			this.deps.gh.isAvailable(cwd).catch(() => false),
			this.deps.connections(),
		]);
		this.detection = {
			routes: githubRoutes(signedIn, connections),
			detectedAt: this.now(),
		};
		return this.detection;
	}

	/** The routes, plus GitHub tools the agent has this turn. */
	routes(env: SourceEnv): Route[] {
		const routes = [...(this.detection?.routes ?? [])];
		if (agentHasGitHubTools(env.tools)) {
			routes.push({
				id: "agent-tools",
				label: "GitHub tools in this chat",
				mention: true,
				read: { reason: "Only the agent calls these" },
			});
		}
		return routes;
	}

	probe(env: SourceEnv): SourceState {
		if (!repositoryOf(env)) return "absent";
		if (this.routes(env).length > 0) return "present";
		return this.detection ? "absent" : "unknown";
	}

	capabilities(env: SourceEnv): string[] {
		return [
			"github",
			...this.routes(env).map((route) => `github:${route.id.split(":")[0]}`),
		].filter((tag, index, all) => all.indexOf(tag) === index);
	}

	async refresh(scope: string, env: SourceEnv): Promise<void> {
		const access = this.deps.access();
		const repository = repositoryOf(env);
		const branch = env.git?.branch;
		const cwd = env.workspaceRoot ?? env.cwd;
		if (
			access.role !== "read" ||
			!access.readAllowed ||
			!access.scopes.includes(scope) ||
			!repository ||
			!branch ||
			!cwd
		)
			return;
		if (!this.detection?.routes.some((route) => route.id === "gh")) return;
		const key = `${repository}#${branch}`;
		const snapshot: Snapshot =
			this.snapshot?.key === key ? this.snapshot : { key };
		const gh = this.deps.gh;
		const fetchedAt = this.now();
		if (scope === "pr" || scope === "reviews") {
			const pr =
				scope === "pr" || !snapshot.pr
					? await gh.pullRequest(repository, branch, cwd)
					: snapshot.pr.value;
			if (scope === "pr") snapshot.pr = { fetchedAt, value: pr };
			else
				snapshot.reviews = {
					fetchedAt,
					value: pr ? await gh.reviewThreads(repository, pr.number, cwd) : null,
				};
		} else if (scope === "default-ci") {
			const base = await gh.defaultBranch(repository, cwd);
			snapshot.defaultCi = {
				fetchedAt,
				value: base ? await gh.defaultBranchCi(repository, base, cwd) : null,
			};
		}
		this.snapshot = snapshot;
	}

	facts(env: SourceEnv): Facts | "unknown" {
		const access = this.deps.access();
		const routes = this.routes(env);
		if (access.role !== "read" || !access.readAllowed) {
			return {
				heading: "GitHub (connected; no data read)",
				lines: [
					`Suggestions may ask the agent to use it, through ${routes.map((route) => route.label).join("; ")}.`,
				],
				provenance: { connector: this.id, route: routes[0]?.id ?? "none" },
			};
		}
		const repository = repositoryOf(env);
		const branch = env.git?.branch;
		const snapshot = this.snapshot;
		if (!repository || !branch || snapshot?.key !== `${repository}#${branch}`)
			return "unknown";
		const now = this.now();
		const lines: string[] = [];
		let oldest = now;
		const add = (
			entry: { fetchedAt: number } | undefined,
			line: () => string,
		) => {
			if (!entry) return;
			lines.push(line());
			oldest = Math.min(oldest, entry.fetchedAt);
		};
		if (access.scopes.includes("pr"))
			add(snapshot.pr, () => prLine(snapshot.pr?.value ?? null, branch));
		if (access.scopes.includes("reviews"))
			add(snapshot.reviews, () => reviewLine(snapshot.reviews?.value ?? null));
		if (access.scopes.includes("default-ci"))
			add(snapshot.defaultCi, () =>
				defaultCiLine(snapshot.defaultCi?.value ?? null),
			);
		if (lines.length === 0) return "unknown";
		return {
			heading: `GitHub · ${repository} (as of ${ageLabel(oldest, now)})`,
			lines,
			fetchedAt: oldest,
			provenance: {
				connector: this.id,
				route: "gh",
				url: snapshot.pr?.value?.url,
			},
		};
	}

	/** This branch's failing checks, when Read has them: the Check CI row's evidence (11 item 2). */
	ciEvidence(
		env: SourceEnv,
	): { failingChecks: string[]; url?: string } | undefined {
		const access = this.deps.access();
		const repository = repositoryOf(env);
		const pr = this.snapshot?.pr?.value;
		if (
			access.role !== "read" ||
			!access.readAllowed ||
			!access.scopes.includes("pr") ||
			!pr
		)
			return undefined;
		if (this.snapshot?.key !== `${repository}#${env.git?.branch}`)
			return undefined;
		const failingChecks = pr.checks
			.filter((check) => check.state === "failure")
			.map((check) => check.name);
		return { failingChecks, url: pr.url };
	}

	preview(env: SourceEnv): Facts | "unknown" {
		return this.facts(env);
	}
}
