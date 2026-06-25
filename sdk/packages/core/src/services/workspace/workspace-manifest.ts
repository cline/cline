import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { WorkspaceInfo } from "@cline/shared";
import { processWorkspaceInfo } from "@cline/shared";
import simpleGit from "simple-git";

export interface WorkspaceInfoDiagnostics {
	info: WorkspaceInfo;
	vcsType: "git" | "none";
	error?: { errorType: string; message: string };
}

export interface BuiltWorkspaceMetadata {
	workspaceInfo: WorkspaceInfo;
	workspaceMetadata: string;
	durationMs: number;
	vcsType: "git" | "none";
	initError?: { errorType: string; message: string };
}

export function normalizeWorkspacePath(workspacePath: string): string {
	return resolve(workspacePath);
}

export async function generateWorkspaceInfo(
	workspacePath: string,
): Promise<WorkspaceInfo> {
	return (await generateWorkspaceInfoWithDiagnostics(workspacePath)).info;
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
	let firstError: { errorType: string; message: string } | undefined;

	try {
		const git = simpleGit({ baseDir: rootPath });
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			return { info, vcsType: "none" };
		}

		try {
			const remotes = await git.getRemotes(true);
			if (remotes.length > 0) {
				const associatedRemoteUrls = remotes.map((remote) => {
					const remoteUrl = remote.refs.fetch || remote.refs.push;
					return `${remote.name}: ${remoteUrl}`;
				});
				info.associatedRemoteUrls = associatedRemoteUrls;
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
			firstError ??= toWorkspaceInfoError(error);
		}

		try {
			const latestGitBranchName = (await git.branch()).current.trim();
			if (latestGitBranchName.length > 0) {
				info.latestGitBranchName = latestGitBranchName;
			}
		} catch (error) {
			firstError ??= toWorkspaceInfoError(error);
		}

		return { info, vcsType: "git", error: firstError };
	} catch (error) {
		// Non-git workspaces keep only path + hint.
		return {
			info,
			vcsType: "none",
			error: toWorkspaceInfoError(error),
		};
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
		initError: diagnostics.error,
	};
}
