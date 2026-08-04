import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { WorkspaceInfo } from "@cline/shared";
import { processWorkspaceInfo } from "@cline/shared";
import simpleGit from "simple-git";

export interface WorkspaceInfoDiagnostics {
	info: WorkspaceInfo;
	vcsType: "git" | "none";
	gitState: GitWorkspaceState;
	error?: { errorType: string; message: string };
}

export interface BuiltWorkspaceMetadata {
	workspaceInfo: WorkspaceInfo;
	workspaceMetadata: string;
	durationMs: number;
	vcsType: "git" | "none";
	gitState: GitWorkspaceState;
	initError?: { errorType: string; message: string };
}

export interface GitWorkspaceState {
	url?: string;
	branch?: string;
}

export function readSessionGitMetadata(
	metadata: Record<string, unknown> | undefined,
): GitWorkspaceState {
	const git = metadata?.git;
	if (!git || typeof git !== "object" || Array.isArray(git)) return {};
	const record = git as Record<string, unknown>;
	return {
		...(typeof record.url === "string" && record.url.trim()
			? { url: record.url.trim() }
			: {}),
		...(typeof record.branch === "string" && record.branch.trim()
			? { branch: record.branch.trim() }
			: {}),
	};
}

export function withSessionGitMetadata(
	metadata: Record<string, unknown> | undefined,
	state: GitWorkspaceState,
): Record<string, unknown> | undefined {
	const next = { ...(metadata ?? {}) };
	if (!state.url && !state.branch) {
		delete next.git;
		return Object.keys(next).length > 0 ? next : undefined;
	}
	const existingGit =
		next.git && typeof next.git === "object" && !Array.isArray(next.git)
			? (next.git as Record<string, unknown>)
			: {};
	const git = { ...existingGit };
	if (state.url) git.url = state.url;
	else delete git.url;
	if (state.branch) git.branch = state.branch;
	else delete git.branch;
	next.git = git;
	return next;
}

export function hasCurrentSessionGitMetadata(
	metadata: Record<string, unknown> | undefined,
	state: GitWorkspaceState,
): boolean {
	const current = readSessionGitMetadata(metadata);
	return current.url === state.url && current.branch === state.branch;
}

function selectPrimaryGitRemoteUrl(
	remotes: ReadonlyArray<{
		name: string;
		refs: { fetch: string; push: string };
	}>,
): string | undefined {
	const remote = remotes.find(({ name }) => name === "origin") ?? remotes[0];
	return (remote?.refs.fetch || remote?.refs.push)?.trim() || undefined;
}

export function normalizeWorkspacePath(workspacePath: string): string {
	return resolve(workspacePath);
}

export async function generateWorkspaceInfo(
	workspacePath: string,
): Promise<WorkspaceInfo> {
	return (await generateWorkspaceInfoWithDiagnostics(workspacePath)).info;
}

type GitProbeResult =
	| { status: "ok"; stdout: string }
	| { status: "exit"; exitCode: number }
	| { status: "spawn_error"; code?: string; message: string };

/** Test seam matching {@link execGit}. */
export type GitProbe = (args: string[], cwd: string) => Promise<GitProbeResult>;

/**
 * Run git and report the outcome structurally (spawn error code / exit
 * code) instead of throwing. Git localizes its error text (e.g. "not a git
 * repository" renders in the user's locale), so distinguishing normal
 * environment states from broken workspaces must never rely on messages.
 */
function execGit(args: string[], cwd: string): Promise<GitProbeResult> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, windowsHide: true }, (error, stdout) => {
			if (!error) {
				resolve({ status: "ok", stdout });
				return;
			}
			const code = (error as NodeJS.ErrnoException).code;
			if (typeof code === "number") {
				resolve({ status: "exit", exitCode: code });
				return;
			}
			resolve({
				status: "spawn_error",
				code: typeof code === "string" ? code : undefined,
				message: error.message,
			});
		});
	});
}

/**
 * True when git itself could not be spawned because the binary is not on
 * PATH. Node reports `spawn git ENOENT`; Bun reports `Executable not found
 * in $PATH` or `uv_spawn`/`posix_spawn` ENOENT — all carry `code: "ENOENT"`.
 */
function isMissingGitBinary(result: GitProbeResult): boolean {
	return (
		result.status === "spawn_error" &&
		(result.code === "ENOENT" || result.code === "ENOTFOUND")
	);
}

function toWorkspaceInfoError(error: unknown): {
	errorType: string;
	message: string;
} {
	if (error instanceof Error) {
		return {
			errorType: error.name?.trim() || error.constructor.name || "Error",
			message: error.message,
		};
	}
	return { errorType: "Error", message: String(error) };
}

export async function generateWorkspaceInfoWithDiagnostics(
	workspacePath: string,
	probeGit: GitProbe = execGit,
): Promise<WorkspaceInfoDiagnostics> {
	const rootPath = normalizeWorkspacePath(workspacePath);
	const info: WorkspaceInfo = {
		rootPath,
		// basename("/") and basename("C:\\") are "", which WorkspaceInfoSchema
		// rejects — omit the hint for root paths instead.
		hint: basename(rootPath) || undefined,
	};
	const gitState: GitWorkspaceState = {};
	let firstError: { errorType: string; message: string } | undefined;

	try {
		// Throws when the workspace directory does not exist — that stays a
		// reported error, and it guarantees the probes below never spawn with
		// a bad cwd (which would be indistinguishable from a missing git
		// binary: both fail with ENOENT).
		const git = simpleGit({ baseDir: rootPath });

		// Structural repo detection. Replaces checkIsRepo(), whose error
		// handling matches English-only message text and therefore reported
		// ordinary non-repo folders as init errors on non-English locales.
		const workTree = await probeGit(
			["rev-parse", "--is-inside-work-tree"],
			rootPath,
		);
		if (isMissingGitBinary(workTree)) {
			// git not installed / not on PATH — a normal environment (typical
			// for brand-new dev machines), not an init error.
			return { info, vcsType: "none", gitState };
		}
		if (workTree.status === "exit") {
			// "not a git repository" is a fatal error (exit 128) in any locale.
			// A plain folder is a normal state, not an init error.
			return { info, vcsType: "none", gitState };
		}
		if (workTree.status === "spawn_error") {
			return {
				info,
				vcsType: "none",
				gitState,
				error: { errorType: "GitSpawnError", message: workTree.message },
			};
		}
		if (workTree.stdout.trim() !== "true") {
			// Inside a .git directory: git runs, but there is no work tree.
			return { info, vcsType: "none", gitState };
		}

		try {
			const remotes = await git.getRemotes(true);
			if (remotes.length > 0) {
				const associatedRemoteUrls = remotes.map((remote) => {
					const remoteUrl = remote.refs.fetch || remote.refs.push;
					return `${remote.name}: ${remoteUrl}`;
				});
				info.associatedRemoteUrls = associatedRemoteUrls;
				const url = selectPrimaryGitRemoteUrl(remotes);
				if (url) gitState.url = url;
			}
		} catch (error) {
			firstError ??= toWorkspaceInfoError(error);
		}

		// Structural HEAD resolution: `--verify --quiet` exits 1 (silently)
		// when HEAD does not resolve — a repository with no commits yet, a
		// normal state right after `git init`. Corrupt .git directories never
		// reach this point: git already refuses to recognize them as
		// repositories at the work-tree probe above.
		const head = await probeGit(
			["rev-parse", "--verify", "--quiet", "HEAD"],
			rootPath,
		);
		if (head.status === "ok") {
			const latestGitCommitHash = head.stdout.trim();
			if (latestGitCommitHash.length > 0) {
				info.latestGitCommitHash = latestGitCommitHash;
			}
		} else if (head.status !== "exit" || head.exitCode !== 1) {
			firstError ??= {
				errorType: "GitError",
				message:
					head.status === "exit"
						? `git rev-parse --verify --quiet HEAD exited with code ${head.exitCode}`
						: head.message,
			};
		}

		try {
			const latestGitBranchName = (await git.branch()).current.trim();
			if (latestGitBranchName.length > 0) {
				info.latestGitBranchName = latestGitBranchName;
				gitState.branch = latestGitBranchName;
			}
		} catch (error) {
			firstError ??= toWorkspaceInfoError(error);
		}

		return { info, vcsType: "git", gitState, error: firstError };
	} catch (error) {
		// Non-git workspaces keep only path + hint.
		return {
			info,
			vcsType: "none",
			gitState,
			error: toWorkspaceInfoError(error),
		};
	}
}

/** Read the mutable git identity persisted with an active session. */
export async function readGitWorkspaceState(
	workspacePath: string,
): Promise<GitWorkspaceState | undefined> {
	try {
		const git = simpleGit({ baseDir: normalizeWorkspacePath(workspacePath) });
		if (!(await git.checkIsRepo())) return {};
		const [remotes, branchSummary] = await Promise.all([
			git.getRemotes(true),
			git.branch(),
		]);
		const url = selectPrimaryGitRemoteUrl(remotes);
		const branch = branchSummary.current.trim();
		return {
			...(url ? { url } : {}),
			...(branch ? { branch } : {}),
		};
	} catch {
		return undefined;
	}
}

export async function buildWorkspaceMetadata(cwd: string): Promise<string> {
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	return processWorkspaceInfo(workspaceInfo);
}

/**
 * Generate workspace metadata as both a structured `WorkspaceInfo` object and
 * its pre-serialized string form.
 *
 * Use this instead of calling `buildWorkspaceMetadata` + `generateWorkspaceInfo`
 * separately so the git I/O only happens once.
 */
export async function buildWorkspaceMetadataWithInfo(
	cwd: string,
): Promise<BuiltWorkspaceMetadata> {
	const startedAt = performance.now();
	const diagnostics = await generateWorkspaceInfoWithDiagnostics(cwd);
	const durationMs = performance.now() - startedAt;
	const workspaceInfo = diagnostics.info;
	return {
		workspaceInfo,
		workspaceMetadata: processWorkspaceInfo(workspaceInfo),
		durationMs,
		vcsType: diagnostics.vcsType,
		gitState: diagnostics.gitState,
		initError: diagnostics.error,
	};
}
