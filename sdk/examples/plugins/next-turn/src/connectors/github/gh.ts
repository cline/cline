import { join, sep } from "node:path";
import {
	GH_AVAILABILITY_CACHE_MS,
	GH_EXIT_AUTH,
	GH_FALLBACK_BIN_DIRS,
	GH_PR_LIST_LIMIT,
	GH_REVIEW_THREADS_MAX,
	GH_RUN_LIST_LIMIT,
} from "../../config";
import { errorCode, type RunCommand, runCommand } from "../run";

/**
 * GitHub through `gh`, the connection Cline desktop's PR bar already uses
 * (`apps/examples/desktop-app/sidecar/pull-request.ts` upstream). The PR,
 * its checks and the "gh is not available" memory follow the PR bar exactly,
 * so Next Turn and the PR bar never disagree. Review threads and default-branch
 * CI are read the same way: `gh`, read-only, no bodies.
 */

export type CheckState = "success" | "failure" | "pending" | "skipped";
export type Check = { name: string; state: CheckState };

export type PullRequestFact = {
	number: number;
	title: string;
	url: string;
	state: string;
	isDraft: boolean;
	mergeable?: string;
	checks: Check[];
};

export type ReviewFact = {
	unresolved: number;
	authors: string[];
	paths: string[];
};

export type DefaultCiFact = {
	branch: string;
	failing: string[];
	pending: string[];
	passing: number;
};

type GitHubCheck = {
	__typename?: string;
	name?: string;
	context?: string;
	status?: string;
	conclusion?: string;
	state?: string;
};

const FAILED_RESULTS: ReadonlySet<string> = new Set([
	"FAILURE",
	"ERROR",
	"CANCELLED",
	"TIMED_OUT",
	"ACTION_REQUIRED",
	"STALE",
	"STARTUP_FAILURE",
]);

/** The PR bar's `normalizeCheck`, without the URL. */
export function normalizeCheck(check: GitHubCheck): Check {
	const result =
		check.__typename === "CheckRun"
			? check.status === "COMPLETED"
				? check.conclusion
				: "PENDING"
			: check.state;
	const state: CheckState =
		result === "SUCCESS"
			? "success"
			: result === "NEUTRAL" || result === "SKIPPED"
				? "skipped"
				: FAILED_RESULTS.has(result ?? "")
					? "failure"
					: "pending";
	return { name: check.name || check.context || "Check", state };
}

/**
 * The PR bar's `githubRepository`: `owner/name` from a github.com remote, or null.
 * `workspaceInfo.associatedRemoteUrls` in `@cline/core` prefixes each entry with
 * `<remote>: ` (e.g. `"origin: git@github.com:o/r.git"`), so any leading remote
 * label is stripped first.
 */
export function githubRepository(remote: string): string | null {
	const cleaned = remote.trim().replace(/^[A-Za-z0-9_.-]+:\s+/, "");
	const [, owner, name] =
		cleaned.match(
			/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)\/?$/,
		) ?? [];
	return owner && name ? `${owner}/${name.replace(/\.git$/, "")}` : null;
}

export type GhStatus = "signed-in" | "signed-out" | "not-found";

function isAuthenticationFailure(error: unknown): boolean {
	if (errorCode(error) === GH_EXIT_AUTH) return true;
	const stderr =
		error && typeof error === "object" && "stderr" in error
			? String((error as { stderr?: unknown }).stderr)
			: "";
	return /HTTP 401|Bad credentials/i.test(stderr);
}

const REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: $first) {
        nodes { isResolved isOutdated path comments(first: 1) { nodes { author { login } } } }
      }
    }
  }
}`;

export class GhReader {
	private available: boolean | undefined;
	private state: GhStatus | undefined;
	private binary = "gh";
	private expiresAt = 0;
	private readonly defaultBranches = new Map<string, string | null>();

	constructor(
		private readonly run: RunCommand = runCommand,
		private readonly now: () => number = Date.now,
	) {}

	/** Last probed `gh` status (`signed-in`, `signed-out`, or `not-found`). */
	status(): GhStatus | undefined {
		return this.state;
	}

	/** `gh auth status --active`, remembered for five minutes either way, with macOS PATH fallbacks when launched from Finder. */
	async isAvailable(cwd: string): Promise<boolean> {
		if (this.available !== undefined && this.now() < this.expiresAt)
			return this.available;
		for (const candidate of [
			"gh",
			...GH_FALLBACK_BIN_DIRS.map((parts) => `${sep}${join(...parts, "gh")}`),
		]) {
			try {
				await this.run(
					candidate,
					["auth", "status", "--active", "--hostname", "github.com"],
					cwd,
				);
				this.binary = candidate;
				this.state = "signed-in";
				this.remember(true);
				return true;
			} catch (error) {
				const code = errorCode(error);
				if (code === "ENOENT") continue;
				if (code !== 1 && code !== GH_EXIT_AUTH) throw error;
				this.binary = candidate;
				this.state = "signed-out";
				this.remember(false);
				return false;
			}
		}
		this.state = "not-found";
		this.remember(false);
		return false;
	}

	/** Runs a `gh` read; a sign-in that expired since the last check marks gh unavailable and reads as null. */
	private async json<T>(
		args: readonly string[],
		cwd: string,
	): Promise<T | null> {
		try {
			return JSON.parse(await this.run(this.binary, args, cwd)) as T;
		} catch (error) {
			if (errorCode(error) === "ENOENT" || isAuthenticationFailure(error)) {
				this.state = errorCode(error) === "ENOENT" ? "not-found" : "signed-out";
				this.remember(false);
				return null;
			}
			throw error;
		}
	}

	private remember(available: boolean): void {
		this.available = available;
		this.expiresAt = this.now() + GH_AVAILABILITY_CACHE_MS;
	}

	async defaultBranch(repository: string, cwd: string): Promise<string | null> {
		if (this.defaultBranches.has(repository))
			return this.defaultBranches.get(repository) ?? null;
		const repo = await this.json<{ defaultBranchRef: { name: string } | null }>(
			["repo", "view", repository, "--json", "defaultBranchRef"],
			cwd,
		);
		const name = repo?.defaultBranchRef?.name ?? null;
		if (repo) this.defaultBranches.set(repository, name);
		return name;
	}

	/** This branch's PR from the repository itself, open first, as the PR bar picks it. */
	async pullRequest(
		repository: string,
		branch: string,
		cwd: string,
	): Promise<PullRequestFact | null> {
		type Listed = {
			number: number;
			state: string;
			headRepositoryOwner: { login: string } | null;
			headRepository: { name: string } | null;
		};
		const listed = await this.json<Listed[]>(
			[
				"pr",
				"list",
				"--repo",
				repository,
				"--head",
				branch,
				"--state",
				"all",
				"--limit",
				String(GH_PR_LIST_LIMIT),
				"--json",
				"number,state,headRepositoryOwner,headRepository",
			],
			cwd,
		);
		const [owner = "", name = ""] = repository.split("/");
		const candidates = (listed ?? []).filter(
			(pr) =>
				pr.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase() &&
				pr.headRepository?.name.toLowerCase() === name.toLowerCase(),
		);
		const candidate =
			candidates.find((pr) => pr.state === "OPEN") ?? candidates[0];
		if (!candidate) return null;
		type Viewed = {
			number: number;
			title: string;
			url: string;
			state: string;
			isDraft: boolean;
			mergeable?: string;
			statusCheckRollup: GitHubCheck[] | null;
		};
		const pr = await this.json<Viewed>(
			[
				"pr",
				"view",
				String(candidate.number),
				"--repo",
				repository,
				"--json",
				"number,title,url,state,isDraft,mergeable,statusCheckRollup",
			],
			cwd,
		);
		if (!pr) return null;
		return {
			number: pr.number,
			title: pr.title,
			url: pr.url,
			state: pr.state,
			isDraft: pr.isDraft,
			mergeable: pr.mergeable,
			checks: (pr.statusCheckRollup ?? []).map(normalizeCheck),
		};
	}

	/** Unresolved, current review threads: a count, who opened them, and where. Never a comment's text. */
	async reviewThreads(
		repository: string,
		number: number,
		cwd: string,
	): Promise<ReviewFact | null> {
		const [owner = "", name = ""] = repository.split("/");
		type Thread = {
			isResolved: boolean;
			isOutdated: boolean;
			path?: string;
			comments?: { nodes?: Array<{ author?: { login?: string } | null }> };
		};
		const reply = await this.json<{
			data?: {
				repository?: { pullRequest?: { reviewThreads?: { nodes?: Thread[] } } };
			};
		}>(
			[
				"api",
				"graphql",
				"-f",
				`query=${REVIEW_THREADS_QUERY}`,
				"-F",
				`owner=${owner}`,
				"-F",
				`name=${name}`,
				"-F",
				`number=${number}`,
				"-F",
				`first=${GH_REVIEW_THREADS_MAX}`,
			],
			cwd,
		);
		if (!reply) return null;
		const open = (
			reply.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []
		).filter((thread) => !thread.isResolved && !thread.isOutdated);
		const authors = new Set<string>();
		const paths = new Set<string>();
		for (const thread of open) {
			const login = thread.comments?.nodes?.[0]?.author?.login;
			if (login) authors.add(login);
			if (thread.path) paths.add(thread.path);
		}
		return {
			unresolved: open.length,
			authors: [...authors].sort(),
			paths: [...paths].sort(),
		};
	}

	/** The latest run of each workflow on the default branch. */
	async defaultBranchCi(
		repository: string,
		branch: string,
		cwd: string,
	): Promise<DefaultCiFact | null> {
		type Run = {
			workflowName?: string;
			name?: string;
			status?: string;
			conclusion?: string;
		};
		const runs = await this.json<Run[]>(
			[
				"run",
				"list",
				"--repo",
				repository,
				"--branch",
				branch,
				"--limit",
				String(GH_RUN_LIST_LIMIT),
				"--json",
				"workflowName,name,status,conclusion",
			],
			cwd,
		);
		if (!runs) return null;
		const latest = new Map<string, Run>();
		for (const run of runs) {
			const workflow = run.workflowName || run.name || "workflow";
			if (!latest.has(workflow)) latest.set(workflow, run);
		}
		const fact: DefaultCiFact = {
			branch,
			failing: [],
			pending: [],
			passing: 0,
		};
		for (const [workflow, run] of latest) {
			if (run.status !== "completed") fact.pending.push(workflow);
			else if (
				run.conclusion === "success" ||
				run.conclusion === "skipped" ||
				run.conclusion === "neutral"
			)
				fact.passing += 1;
			else fact.failing.push(workflow);
		}
		fact.failing.sort();
		fact.pending.sort();
		return fact;
	}
}
