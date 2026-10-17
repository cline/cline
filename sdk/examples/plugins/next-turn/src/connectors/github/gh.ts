import {
	GH_AVAILABILITY_CACHE_MS,
	GH_PR_LIST_LIMIT,
	GH_REVIEW_THREADS_MAX,
	GH_RUN_LIST_LIMIT,
} from "../../config";
import { errorCode, type RunCommand, runCommand } from "../../run";
import { isRecord } from "../../values";

/**
 * GitHub through `gh`, the connection Cline desktop's PR bar already uses
 * (`apps/examples/desktop-app/sidecar/pull-request.ts` upstream). The PR and
 * its checks are read the way the PR bar reads them, and gh is remembered as
 * unavailable the way it remembers. Review threads and default-branch CI are
 * read the same way: `gh`, read-only, no bodies.
 */

/** `gh`'s exit code for missing or invalid authentication; 1 is its general failure. */
const GH_EXIT_AUTH = 4;

/** `gh` on PATH, then the Homebrew installs a Finder-launched app cannot see on its PATH. */
const GH_CANDIDATES = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];

type CheckState = "success" | "failure" | "pending" | "skipped";
type Check = { name: string; state: CheckState };

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

function isAuthenticationFailure(error: unknown): boolean {
	if (errorCode(error) === GH_EXIT_AUTH) return true;
	const stderr = isRecord(error) ? String(error.stderr ?? "") : "";
	return /HTTP 401|Bad credentials/i.test(stderr);
}

function ownerAndName(repository: string): { owner: string; name: string } {
	const [owner = "", name = ""] = repository.split("/");
	return { owner, name };
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
	private binary = "gh";
	private expiresAt = 0;
	private readonly defaultBranches = new Map<string, string | null>();

	constructor(
		private readonly run: RunCommand = runCommand,
		private readonly now: () => number = Date.now,
	) {}

	/** `gh auth status --active`, remembered for `GH_AVAILABILITY_CACHE_MS` either way, with macOS PATH fallbacks when launched from Finder. */
	async isAvailable(cwd: string): Promise<boolean> {
		if (this.available !== undefined && this.now() < this.expiresAt)
			return this.available;
		for (const candidate of GH_CANDIDATES) {
			try {
				await this.run(
					candidate,
					["auth", "status", "--active", "--hostname", "github.com"],
					cwd,
				);
				this.binary = candidate;
				this.remember(true);
				return true;
			} catch (error) {
				const code = errorCode(error);
				if (code === "ENOENT") continue;
				if (code !== 1 && code !== GH_EXIT_AUTH) throw error;
				this.binary = candidate;
				this.remember(false);
				return false;
			}
		}
		this.remember(false);
		return false;
	}

	/**
	 * Runs a `gh` read. A sign-in that expired, or a `gh` that went missing,
	 * rejects rather than reading as "nothing", so the last facts stay; gh is
	 * then not run again until the memory lapses.
	 */
	private async json<T>(args: readonly string[], cwd: string): Promise<T> {
		if (this.available === false && this.now() < this.expiresAt)
			throw new Error("gh is not available");
		try {
			return JSON.parse(await this.run(this.binary, args, cwd)) as T;
		} catch (error) {
			if (errorCode(error) === "ENOENT" || isAuthenticationFailure(error))
				this.remember(false);
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
		const name = repo.defaultBranchRef?.name ?? null;
		this.defaultBranches.set(repository, name);
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
		const { owner, name } = ownerAndName(repository);
		const candidates = listed.filter(
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
	): Promise<ReviewFact> {
		const { owner, name } = ownerAndName(repository);
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
	): Promise<DefaultCiFact> {
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
