import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	PullRequestCheck,
	PullRequestStatus,
} from "../webview/lib/pull-request";

const execFileAsync = promisify(execFile);
type RunCommand = (
	file: string,
	args: string[],
	cwd: string,
) => Promise<string>;
const runCommand: RunCommand = async (file, args, cwd) => {
	const { stdout } = await execFileAsync(file, args, {
		cwd,
		encoding: "utf8",
		timeout: 15_000,
		maxBuffer: 2 * 1024 * 1024,
		env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
	});
	return stdout.trim();
};

type GitHubCheck = {
	__typename: string;
	name?: string;
	context?: string;
	status?: string;
	conclusion?: string;
	state?: string;
	detailsUrl?: string;
	targetUrl?: string;
};

export function normalizeCheck(check: GitHubCheck): PullRequestCheck {
	const result =
		check.__typename === "CheckRun"
			? check.status === "COMPLETED"
				? check.conclusion
				: "PENDING"
			: check.state;
	return {
		name: check.name || check.context || "Check",
		state:
			result === "SUCCESS"
				? "success"
				: result === "NEUTRAL" || result === "SKIPPED"
					? "skipped"
					: [
								"FAILURE",
								"ERROR",
								"CANCELLED",
								"TIMED_OUT",
								"ACTION_REQUIRED",
								"STALE",
								"STARTUP_FAILURE",
							].includes(result ?? "")
						? "failure"
						: "pending",
		url: safeHttpUrl(check.detailsUrl || check.targetUrl),
	};
}

function safeHttpUrl(value?: string): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

export function githubRepository(remote: string): string | null {
	const match = remote.match(
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)\/?$/,
	);
	return match ? `${match[1]}/${match[2].replace(/\.git$/, "")}` : null;
}

type GitHubPullRequest = Omit<
	NonNullable<PullRequestStatus["pullRequest"]>,
	"checks"
> & {
	headRepositoryOwner: { login: string } | null;
	headRepository: { name: string } | null;
	statusCheckRollup: GitHubCheck[] | null;
};

// Shared across workspaces: missing credentials are a machine-level capability,
// not a repository failure. Retry after installation/login without polling gh.
export const GITHUB_AVAILABILITY_CACHE_MS = 5 * 60_000;

function commandErrorCode(error: unknown): unknown {
	return error && typeof error === "object" && "code" in error
		? error.code
		: undefined;
}

function isAuthenticationFailure(error: unknown): boolean {
	if (commandErrorCode(error) === 4) return true;
	const stderr =
		error && typeof error === "object" && "stderr" in error
			? String(error.stderr)
			: "";
	return /HTTP 401|Bad credentials/i.test(stderr);
}

export function createPullRequestStatusReader({
	run = runCommand,
	now = Date.now,
}: {
	run?: RunCommand;
	now?: () => number;
} = {}) {
	let available: boolean | undefined;
	let expiresAt = 0;
	let probe: Promise<boolean> | undefined;

	function markUnavailable() {
		available = false;
		expiresAt = now() + GITHUB_AVAILABILITY_CACHE_MS;
	}

	async function isAvailable(cwd: string): Promise<boolean> {
		if (available !== undefined && now() < expiresAt) return available;
		if (probe) return probe;
		probe = (async () => {
			try {
				await run(
					"gh",
					["auth", "status", "--active", "--hostname", "github.com"],
					cwd,
				);
				available = true;
				expiresAt = now() + GITHUB_AVAILABILITY_CACHE_MS;
				return true;
			} catch (error) {
				// gh auth status documents exit 1 for missing/invalid authentication.
				const code = commandErrorCode(error);
				if (code === "ENOENT" || code === 1 || code === 4) {
					markUnavailable();
					return false;
				}
				throw error;
			}
		})();
		try {
			return await probe;
		} finally {
			probe = undefined;
		}
	}

	/** Read-only: creation is reviewed and submitted in GitHub's compare form. */
	return async function readPullRequestStatus(
		cwd: string,
	): Promise<PullRequestStatus | null> {
		if (available === false && now() < expiresAt) return null;
		const branch = await run("git", ["branch", "--show-current"], cwd).catch(
			() => "",
		);
		if (!branch) return null;
		const remote = await run("git", ["remote", "get-url", "origin"], cwd).catch(
			() => "",
		);
		const repository = githubRepository(remote);
		if (!repository) return null;
		try {
			if (!(await isAvailable(cwd))) return null;
			const repo = JSON.parse(
				await run(
					"gh",
					["repo", "view", repository, "--json", "defaultBranchRef"],
					cwd,
				),
			) as { defaultBranchRef: { name: string } | null };
			const base = repo.defaultBranchRef?.name;
			// The default branch can have years-old PRs from earlier branch workflows.
			// Those do not describe the current work, and it is not a PR source branch.
			if (branch === base) return null;
			const prsJson = await run(
				"gh",
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
					"100",
					"--json",
					"number,state,headRepositoryOwner,headRepository",
				],
				cwd,
			);
			const [owner, name] = repository.split("/");
			const candidates = (
				JSON.parse(prsJson) as Pick<
					GitHubPullRequest,
					"number" | "state" | "headRepositoryOwner" | "headRepository"
				>[]
			).filter(
				(pr) =>
					pr.headRepositoryOwner?.login.toLowerCase() === owner.toLowerCase() &&
					pr.headRepository?.name.toLowerCase() === name.toLowerCase(),
			);
			const candidate =
				candidates.find((pr) => pr.state === "OPEN") ?? candidates[0];
			const pr = candidate
				? (JSON.parse(
						await run(
							"gh",
							[
								"pr",
								"view",
								String(candidate.number),
								"--repo",
								repository,
								"--json",
								"number,title,url,state,isDraft,mergeable,mergeStateStatus,additions,deletions,statusCheckRollup",
							],
							cwd,
						),
					) as GitHubPullRequest)
				: null;
			return {
				repository,
				branch,
				createUrl:
					base && branch !== base
						? `https://github.com/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`
						: null,
				pullRequest: pr
					? {
							number: pr.number,
							title: pr.title,
							url: pr.url,
							state: pr.state,
							isDraft: pr.isDraft,
							mergeable: pr.mergeable,
							mergeStateStatus: pr.mergeStateStatus,
							additions: pr.additions,
							deletions: pr.deletions,
							checks: (pr.statusCheckRollup ?? []).map(normalizeCheck),
						}
					: null,
			};
		} catch (error) {
			// Authentication can expire while a positive availability result is cached.
			if (
				commandErrorCode(error) === "ENOENT" ||
				isAuthenticationFailure(error)
			) {
				markUnavailable();
				return null;
			}
			throw new Error(
				"Could not load pull request status. Check your connection and try again.",
			);
		}
	};
}

export const getPullRequestStatus = createPullRequestStatusReader();
