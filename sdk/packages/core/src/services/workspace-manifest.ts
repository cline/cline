import { basename, resolve } from "node:path";
import type { WorkspaceInfo } from "@clinebot/shared";
import { processWorkspaceInfo } from "@clinebot/shared";
import simpleGit from "simple-git";

export function normalizeWorkspacePath(workspacePath: string): string {
	return resolve(workspacePath);
}

export async function generateWorkspaceInfo(
	workspacePath: string,
): Promise<WorkspaceInfo> {
	const rootPath = normalizeWorkspacePath(workspacePath);
	const info: WorkspaceInfo = {
		rootPath,
		hint: basename(rootPath),
	};

	try {
		const git = simpleGit({ baseDir: rootPath });
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			return info;
		}

		const remotes = await git.getRemotes(true);
		if (remotes.length > 0) {
			const associatedRemoteUrls = remotes.map((remote) => {
				const remoteUrl = remote.refs.fetch || remote.refs.push;
				return `${remote.name}: ${remoteUrl}`;
			});
			info.associatedRemoteUrls = associatedRemoteUrls;
		}

		const latestGitCommitHash = (await git.revparse(["HEAD"])).trim();
		if (latestGitCommitHash.length > 0) {
			info.latestGitCommitHash = latestGitCommitHash;
		}

		const latestGitBranchName = (await git.branch()).current.trim();
		if (latestGitBranchName.length > 0) {
			info.latestGitBranchName = latestGitBranchName;
		}
	} catch {
		// Non-git workspaces keep only path + hint.
	}

	return info;
}

export async function buildWorkspaceMetadata(cwd: string): Promise<string> {
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	return processWorkspaceInfo(workspaceInfo);
}
