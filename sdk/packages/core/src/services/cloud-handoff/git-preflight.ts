import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitCommand = (
	args: readonly string[],
	options: { cwd: string; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr?: string }>;

export type CloudHandoffGitContext = {
	repoUrl: string;
	branch: string;
	remoteName: string;
	headSha: string;
	workspaceRelativePath?: string;
};

export type CloudHandoffGitPreflightErrorCode =
	| "not_git_repository"
	| "dirty_worktree"
	| "detached_head"
	| "missing_upstream"
	| "unsupported_remote"
	| "remote_branch_missing"
	| "unpushed_commits"
	| "git_command_failed";

export class CloudHandoffGitPreflightError extends Error {
	constructor(
		readonly code: CloudHandoffGitPreflightErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "CloudHandoffGitPreflightError";
	}
}

function defaultGitCommand(
	args: readonly string[],
	options: { cwd: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync("git", args, {
		cwd: options.cwd,
		encoding: "utf8",
		windowsHide: true,
		signal: options.signal,
		timeout: 15_000,
		maxBuffer: 10 * 1024 * 1024,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes",
		},
	});
}

function trimGitSuffix(pathname: string): string {
	let start = 0;
	let end = pathname.length;
	while (start < end && pathname[start] === "/") start += 1;
	while (end > start && pathname[end - 1] === "/") end -= 1;
	const trimmed = pathname.slice(start, end);
	return trimmed.toLowerCase().endsWith(".git")
		? trimmed.slice(0, -4)
		: trimmed;
}

/** Converts supported GitHub clone URLs to the URL expected by cloud sessions. */
export function normalizeGitHubRemoteUrl(remoteUrl: string): string | null {
	const value = remoteUrl.trim();
	if (!value) return null;

	const scpMatch = value.match(/^(?:[^@/\s]+@)?github\.com:([^\s]+)$/i);
	if (scpMatch?.[1]) {
		const path = trimGitSuffix(scpMatch[1]);
		return path.split("/").length === 2 ? `https://github.com/${path}` : null;
	}

	try {
		const url = new URL(value);
		if (url.hostname.toLowerCase() !== "github.com") return null;
		if (!new Set(["https:", "http:", "ssh:", "git:"]).has(url.protocol)) {
			return null;
		}
		const path = trimGitSuffix(url.pathname);
		return path.split("/").length === 2 ? `https://github.com/${path}` : null;
	} catch {
		return null;
	}
}

function commandErrorMessage(error: unknown): string {
	if (!error || typeof error !== "object") return "";
	const stderr = (error as { stderr?: unknown }).stderr;
	return typeof stderr === "string" ? stderr.trim() : "";
}

function commandExitCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "number" ? code : undefined;
}

async function runRequired(
	git: GitCommand,
	cwd: string,
	args: readonly string[],
	code: CloudHandoffGitPreflightErrorCode,
	message: string,
	signal?: AbortSignal,
	normalizeOutput: (stdout: string) => string = (stdout) => stdout.trim(),
): Promise<string> {
	try {
		return normalizeOutput((await git(args, { cwd, signal })).stdout);
	} catch (error) {
		const detail = commandErrorMessage(error);
		throw new CloudHandoffGitPreflightError(
			code,
			detail ? `${message} (${detail})` : message,
			{ cause: error },
		);
	}
}

function parseRemoteHead(stdout: string, branch: string): string | null {
	const expectedRef = `refs/heads/${branch}`;
	for (const line of stdout.split("\n")) {
		const [sha, ref] = line.trim().split(/\s+/, 2);
		if (ref === expectedRef && /^[0-9a-f]{40,64}$/i.test(sha ?? "")) {
			return sha ?? null;
		}
	}
	return null;
}

function normalizeWorkspaceRelativePath(value: string): string | undefined {
	const normalized = value.replace(/[\r\n]+$/, "").replace(/\/+$/, "");
	if (!normalized) return undefined;
	const parts = normalized.split("/");
	if (
		normalized.startsWith("/") ||
		parts.some((part) => !part || part === "." || part === "..")
	) {
		throw new CloudHandoffGitPreflightError(
			"git_command_failed",
			"Could not resolve the workspace path relative to the Git repository.",
		);
	}
	return normalized;
}

/**
 * Refuses handoff unless a fresh GitHub clone of the upstream branch will be
 * byte-for-byte anchored at the current local commit.
 */
export async function preflightCloudHandoffGit(input: {
	cwd: string;
	git?: GitCommand;
	signal?: AbortSignal;
}): Promise<CloudHandoffGitContext> {
	const git = input.git ?? defaultGitCommand;
	const cwd = input.cwd;

	const insideWorktree = await runRequired(
		git,
		cwd,
		["rev-parse", "--is-inside-work-tree"],
		"not_git_repository",
		"Cloud handoff requires a Git repository.",
		input.signal,
	);
	if (insideWorktree !== "true") {
		throw new CloudHandoffGitPreflightError(
			"not_git_repository",
			"Cloud handoff requires a Git working tree.",
		);
	}
	const workspaceRelativePath = normalizeWorkspaceRelativePath(
		await runRequired(
			git,
			cwd,
			["rev-parse", "--show-prefix"],
			"git_command_failed",
			"Could not resolve the workspace path relative to the Git repository.",
			input.signal,
			(stdout) => stdout.replace(/[\r\n]+$/, ""),
		),
	);

	const dirty = await runRequired(
		git,
		cwd,
		[
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
			"--ignore-submodules=none",
		],
		"git_command_failed",
		"Could not inspect the Git worktree.",
		input.signal,
	);
	if (dirty) {
		const lines = dirty.split("\n").filter(Boolean);
		const summary = lines.slice(0, 5).join("\n");
		const remainder =
			lines.length > 5 ? `\n...and ${lines.length - 5} more` : "";
		throw new CloudHandoffGitPreflightError(
			"dirty_worktree",
			`Commit and push local changes before handing off to cloud. Uncommitted files are not transferred.\n\n${summary}${remainder}`,
		);
	}

	let branch: string;
	try {
		branch = (
			await git(["symbolic-ref", "--quiet", "--short", "HEAD"], {
				cwd,
				signal: input.signal,
			})
		).stdout.trim();
	} catch (error) {
		const detached = commandExitCode(error) === 1;
		const detail = commandErrorMessage(error);
		const message = detached
			? "Cloud handoff requires a checked-out branch; detached HEAD is not supported."
			: "Could not inspect the current Git branch.";
		throw new CloudHandoffGitPreflightError(
			detached ? "detached_head" : "git_command_failed",
			detail ? `${message} (${detail})` : message,
			{ cause: error },
		);
	}
	if (!branch) {
		throw new CloudHandoffGitPreflightError(
			"detached_head",
			"Cloud handoff requires a checked-out branch; detached HEAD is not supported.",
		);
	}

	const [remoteName, mergeRef, headSha] = await Promise.all([
		runRequired(
			git,
			cwd,
			["config", "--get", `branch.${branch}.remote`],
			"missing_upstream",
			`Branch ${branch} has no upstream. Push it with -u before handing off.`,
			input.signal,
		),
		runRequired(
			git,
			cwd,
			["config", "--get", `branch.${branch}.merge`],
			"missing_upstream",
			`Branch ${branch} has no upstream. Push it with -u before handing off.`,
			input.signal,
		),
		runRequired(
			git,
			cwd,
			["rev-parse", "HEAD"],
			"git_command_failed",
			"Could not resolve the current commit.",
			input.signal,
		),
	]);
	if (
		!remoteName ||
		remoteName === "." ||
		!mergeRef.startsWith("refs/heads/")
	) {
		throw new CloudHandoffGitPreflightError(
			"missing_upstream",
			`Branch ${branch} has no remote branch upstream. Push it with -u before handing off.`,
		);
	}

	const upstreamBranch = mergeRef.slice("refs/heads/".length);
	let rawRemoteUrl = remoteName;
	if (!normalizeGitHubRemoteUrl(remoteName)) {
		try {
			rawRemoteUrl = (
				await git(["remote", "get-url", remoteName], {
					cwd,
					signal: input.signal,
				})
			).stdout.trim();
		} catch {
			// Git may echo credential-bearing remote URLs in stderr. Do not retain
			// the raw command error in either the message or the cause chain.
			throw new CloudHandoffGitPreflightError(
				"missing_upstream",
				"Could not resolve the upstream remote.",
			);
		}
	}
	const repoUrl = normalizeGitHubRemoteUrl(rawRemoteUrl);
	if (!repoUrl) {
		throw new CloudHandoffGitPreflightError(
			"unsupported_remote",
			"Cloud handoff currently requires a github.com upstream remote.",
		);
	}

	let remoteOutput: string;
	try {
		remoteOutput = (
			await git(["ls-remote", "--exit-code", remoteName, mergeRef], {
				cwd,
				signal: input.signal,
			})
		).stdout.trim();
	} catch (error) {
		const missing = commandExitCode(error) === 2;
		const message = missing
			? `The upstream branch ${upstreamBranch} was not found. Push it before handing off.`
			: "Could not verify the remote branch. Check your network and GitHub authentication, then try again.";
		throw new CloudHandoffGitPreflightError(
			missing ? "remote_branch_missing" : "git_command_failed",
			message,
		);
	}
	const remoteSha = parseRemoteHead(remoteOutput, upstreamBranch);
	if (!remoteSha) {
		throw new CloudHandoffGitPreflightError(
			"remote_branch_missing",
			`The upstream branch ${upstreamBranch} was not found. Push it before handing off.`,
		);
	}
	if (remoteSha.toLowerCase() !== headSha.toLowerCase()) {
		throw new CloudHandoffGitPreflightError(
			"unpushed_commits",
			`Local HEAD does not match the upstream branch ${upstreamBranch}. Push the current commit before handing off.`,
		);
	}

	return {
		repoUrl,
		branch: upstreamBranch,
		remoteName: normalizeGitHubRemoteUrl(remoteName) ? repoUrl : remoteName,
		headSha,
		...(workspaceRelativePath ? { workspaceRelativePath } : {}),
	};
}
