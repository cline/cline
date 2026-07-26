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

/**
 * Git failures that reflect a normal repository state — e.g. a freshly
 * initialized repo with no commits, where `git rev-parse HEAD` fails —
 * rather than a broken workspace. These must not be reported as
 * workspace init errors.
 */
function isBenignGitError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	// Deliberately excludes "bad revision": that can also indicate a corrupt
	// .git/HEAD, which is a genuinely broken workspace worth reporting.
	return /unknown revision|ambiguous argument|does not have any commits yet/i.test(
		message,
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
): Promise<WorkspaceInfoDiagnostics> {
	const rootPath = normalizeWorkspacePath(workspacePath);
	const info: WorkspaceInfo = {
		rootPath,
		hint: basename(rootPath),
	};
	const gitState: GitWorkspaceState = {};
	let firstError: { errorType: string; message: string } | undefined;

	try {
		const git = simpleGit({ baseDir: rootPath });
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
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

		try {
			const latestGitCommitHash = (await git.revparse(["HEAD"])).trim();
			if (latestGitCommitHash.length > 0) {
				info.latestGitCommitHash = latestGitCommitHash;
			}
		} catch (error) {
			if (!isBenignGitError(error)) {
				firstError ??= toWorkspaceInfoError(error);
			}
		}

		try {
			const latestGitBranchName = (await git.branch()).current.trim();
			if (latestGitBranchName.length > 0) {
				info.latestGitBranchName = latestGitBranchName;
				gitState.branch = latestGitBranchName;
			}
		} catch (error) {
			if (!isBenignGitError(error)) {
				firstError ??= toWorkspaceInfoError(error);
			}
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
