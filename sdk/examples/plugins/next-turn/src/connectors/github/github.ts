import {
	GITHUB_DEFAULT_CI_EVERY_MINUTES,
	GITHUB_NAMES_MAX,
	GITHUB_PR_EVERY_MINUTES,
	GITHUB_REVIEWS_EVERY_MINUTES,
	GITHUB_TITLE_MAX,
} from "../../config";
import {
	type DatedLine,
	datedFacts,
	mentionOnlyFacts,
} from "../../context/facts";
import { clip } from "../../context/redact";
import type { Facts, SourceEnv, SourceState } from "../../context/source";
import type { GitHubEvidence } from "../../planner/rules";
import type { ClineConnections, McpServer } from "../cline-connections";
import { COMPOSIO_ROUTE, GITHUB_TOOLKIT } from "../composio";
import {
	type Access,
	type Connector,
	mcpConnectorId,
	type ReadScope,
	type Route,
} from "../connector";
import { mcpServerLabel } from "../mcp";
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
 * | Composio's GitHub toolkit on the Cline account | yes | not yet: Cline does not expose its Composio tools to plugins |
 * | A GitHub MCP server in Cline's settings | yes | through its own MCP connector's pinned reads |
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

const GITHUB = /github/i;

const GH_ROUTE: Route = {
	id: "gh",
	label: "gh, signed in (the sign-in Cline's PR bar uses)",
	read: true,
};

const AGENT_TOOLS_ROUTE: Route = {
	id: "agent-tools",
	label: "GitHub tools in this chat",
	read: { reason: "Only the agent calls these" },
};

function githubMcpServers(servers: readonly McpServer[]): McpServer[] {
	return servers.filter(
		(server) =>
			!server.disabled &&
			(GITHUB.test(server.name) || GITHUB.test(server.target)),
	);
}

function repositoryOf(env: SourceEnv): string | null {
	for (const remote of env.git?.remotes ?? []) {
		const repository = githubRepository(remote);
		if (repository) return repository;
	}
	return null;
}

/** The repository and branch this workspace is on: what a snapshot of reads belongs to. */
type Target = { repository: string; branch: string; key: string };

function targetOf(env: SourceEnv): Target | undefined {
	const repository = repositoryOf(env);
	const branch = env.git?.branch;
	return repository && branch
		? { repository, branch, key: `${repository}#${branch}` }
		: undefined;
}

/** The Cline connections GitHub can go through here, before this turn's tools are known. */
export function githubRoutes(
	ghSignedIn: boolean,
	connections: ClineConnections,
): Route[] {
	const routes: Route[] = ghSignedIn ? [GH_ROUTE] : [];
	if (
		connections.composio.some(
			(toolkit) => toolkit.toolkit === GITHUB_TOOLKIT && toolkit.connected,
		)
	)
		routes.push(COMPOSIO_ROUTE);
	for (const server of githubMcpServers(connections.mcp)) {
		const label = mcpServerLabel(server.name);
		routes.push({
			id: mcpConnectorId(server.name),
			label,
			read: { reason: `Pin read-only tools on ${label} to read through it` },
		});
	}
	return routes;
}

/** One repository and branch's reads: the pull request itself, which reviews and CI evidence reuse, and each scope's rendered line. */
type Snapshot = {
	key: string;
	pr?: { fetchedAt: number; value: PullRequestFact | null };
	lines: Map<string, DatedLine>;
};

function failingCheckNames(pr: PullRequestFact): string[] {
	return pr.checks
		.filter((check) => check.state === "failure")
		.map((check) => check.name);
}

function named(names: readonly string[]): string {
	const shown = names.slice(0, GITHUB_NAMES_MAX).join(", ");
	return names.length > GITHUB_NAMES_MAX
		? `${shown} and ${names.length - GITHUB_NAMES_MAX} more`
		: shown;
}

export function prLine(pr: PullRequestFact | null, branch: string): string {
	if (!pr) return `No pull request for ${branch} yet.`;
	const failing = failingCheckNames(pr);
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

type GitHubConnectorDeps = {
	gh: GhReader;
	access: () => Access;
	now?: () => number;
};

export class GitHubConnector implements Connector {
	readonly id = "github";
	readonly displayName = "GitHub";
	readonly tier = "T3" as const;
	readonly scopes = GITHUB_SCOPES;
	private detectedRoutes: Route[] | undefined;
	private snapshot: Snapshot | undefined;
	private latestKey: string | undefined;
	private pendingPr:
		| { key: string; value: Promise<PullRequestFact | null> }
		| undefined;

	constructor(private readonly deps: GitHubConnectorDeps) {}

	private now(): number {
		return (this.deps.now ?? Date.now)();
	}

	/**
	 * Background: which Cline routes exist. The probe answers from the last
	 * detection, and a `gh` check that fails rather than answers keeps it.
	 */
	async detect(env: SourceEnv, connections: ClineConnections): Promise<void> {
		const signedIn = await this.deps.gh
			.isAvailable(env.workspaceRoot ?? ".")
			.catch(
				() =>
					this.detectedRoutes?.some((route) => route.id === GH_ROUTE.id) ??
					false,
			);
		this.detectedRoutes = githubRoutes(signedIn, connections);
	}

	/** The routes, plus GitHub tools the agent has this turn. */
	routes(env: SourceEnv): Route[] {
		const detected = this.detectedRoutes ?? [];
		return env.tools.some((tool) => GITHUB.test(tool))
			? [...detected, AGENT_TOOLS_ROUTE]
			: [...detected];
	}

	probe(env: SourceEnv): SourceState {
		if (!repositoryOf(env)) return "absent";
		if (this.routes(env).length > 0) return "present";
		return this.detectedRoutes ? "absent" : "unknown";
	}

	capabilities(env: SourceEnv): string[] {
		return [
			...new Set([
				"github",
				...this.routes(env).map((route) => `github:${route.id.split(":")[0]}`),
			]),
		];
	}

	private snapshotFor(target: Target | undefined): Snapshot | undefined {
		return target && this.snapshot?.key === target.key
			? this.snapshot
			: undefined;
	}

	async refresh(scope: string, env: SourceEnv): Promise<void> {
		const access = this.deps.access();
		const target = targetOf(env);
		const cwd = env.workspaceRoot;
		if (
			!access.readAllowed ||
			!access.scopes.includes(scope) ||
			!target ||
			!cwd
		)
			return;
		if (!this.detectedRoutes?.some((route) => route.id === GH_ROUTE.id)) return;
		const { repository, branch, key } = target;
		this.latestKey = key;
		const gh = this.deps.gh;
		const fetchedAt = this.now();
		let pr: Snapshot["pr"];
		let line: string;
		if (scope === "pr") {
			const value = gh.pullRequest(repository, branch, cwd).finally(() => {
				if (this.pendingPr?.value === value) this.pendingPr = undefined;
			});
			this.pendingPr = { key, value };
			pr = { fetchedAt, value: await value };
			line = prLine(pr.value, branch);
		} else if (scope === "reviews") {
			const pending =
				this.pendingPr?.key === key ? this.pendingPr.value : undefined;
			const known = this.snapshotFor(target)?.pr;
			const current = pending
				? await pending
				: known
					? known.value
					: await gh.pullRequest(repository, branch, cwd);
			line = reviewLine(
				current
					? await gh.reviewThreads(repository, current.number, cwd)
					: null,
			);
		} else if (scope === "default-ci") {
			const base = await gh.defaultBranch(repository, cwd);
			line = defaultCiLine(
				base ? await gh.defaultBranchCi(repository, base, cwd) : null,
			);
		} else return;
		if (key !== this.latestKey) return;
		if (this.snapshot?.key !== key) this.snapshot = { key, lines: new Map() };
		if (pr) this.snapshot.pr = pr;
		this.snapshot.lines.set(scope, { fetchedAt, line });
	}

	facts(env: SourceEnv): Facts | "unknown" {
		const access = this.deps.access();
		if (!access.readAllowed)
			return mentionOnlyFacts(
				this.displayName,
				"it",
				this.routes(env)
					.map((route) => route.label)
					.join("; "),
			);
		const target = targetOf(env);
		const snapshot = this.snapshotFor(target);
		if (!target || !snapshot) return "unknown";
		return datedFacts(
			`${this.displayName} · ${target.repository}`,
			GITHUB_SCOPES.filter((scope) => access.scopes.includes(scope.id)).flatMap(
				(scope) => snapshot.lines.get(scope.id) ?? [],
			),
			this.now(),
		);
	}

	/** This branch's failing checks, when Read has them: the Check CI row's evidence. */
	ciEvidence(env: SourceEnv): Omit<GitHubEvidence, "pushed"> | undefined {
		const access = this.deps.access();
		const pr = this.snapshotFor(targetOf(env))?.pr?.value;
		if (!access.readAllowed || !access.scopes.includes("pr") || !pr)
			return undefined;
		return { failingChecks: failingCheckNames(pr), url: pr.url };
	}
}
