import { VcsType, WorkspaceRoot } from "@shared/multi-root/types"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getLatestGitCommitHash, isGitRepository } from "@/utils/git"
import { getCwd, getDesktopDir } from "@/utils/path"

/**
 * Detect the VCS type for a given directory path.
 * Currently supports Git; returns None otherwise.
 */
export async function detectVcs(dirPath: string): Promise<VcsType> {
	try {
		const isGit = await isGitRepository(dirPath)
		return isGit ? VcsType.Git : VcsType.None
	} catch {
		return VcsType.None
	}
}

/**
 * Detect workspace roots from the host editor (VS Code, etc.).
 * Falls back to current working directory when no workspace folders are present.
 */
export async function detectWorkspaceRoots(): Promise<WorkspaceRoot[]> {
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})

	if (!workspacePaths.paths || workspacePaths.paths.length === 0) {
		// No workspace folders, use cwd
		const cwd = await getCwd(getDesktopDir())
		return [
			{
				path: cwd,
				name: path.basename(cwd),
				vcs: VcsType.None, // Will be detected later if needed
			},
		]
	}

	// Convert workspace paths to WorkspaceRoots
	const roots: WorkspaceRoot[] = []
	for (const workspacePath of workspacePaths.paths) {
		const vcs = await detectVcs(workspacePath)
		roots.push({
			path: workspacePath,
			name: path.basename(workspacePath),
			vcs,
			commitHash: vcs === VcsType.Git ? (await getLatestGitCommitHash(workspacePath)) || undefined : undefined,
		})
	}

	return roots
}
