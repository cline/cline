import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { normalizeGitHubRemoteUrl } from "@shared/cloud/cloud-sessions"
import { WorkspaceCloudDefaults } from "@shared/proto/cline/cloud"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { getGitRemoteUrls } from "@/utils/git"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from "../index"

const execFileAsync = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd })
		return stdout.trim() || undefined
	} catch {
		return undefined
	}
}

/**
 * The branch of `remote` that the checked-out branch corresponds to, or
 * undefined when it has never been pushed there. A cloud sandbox clones
 * from GitHub, so a local-only branch cannot be started from. Prefers the
 * configured upstream, whose name may differ from the local branch.
 */
async function remoteBranchForCheckout(cwd: string, remote: string): Promise<string | undefined> {
	const upstream = await git(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if (upstream?.startsWith(`${remote}/`)) {
		return upstream.slice(remote.length + 1)
	}
	const branch = await git(cwd, "branch", "--show-current")
	if (!branch) {
		return undefined
	}
	const tracked = await git(cwd, "rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`)
	return tracked ? branch : undefined
}

/**
 * Suggests the repository and branch for a cloud task from a working tree's
 * git remotes (preferring `origin`) and the remote branch it has checked
 * out. Empty when the working tree is not a GitHub repository.
 */
export async function resolveWorkspaceCloudDefaults(cwd: string): Promise<{ repoUrl?: string; branch?: string }> {
	const remotes = (await getGitRemoteUrls(cwd)).map((line) => {
		const separator = line.indexOf(": ")
		return { name: line.slice(0, separator), url: line.slice(separator + 2) }
	})
	const origin = remotes.find((remote) => remote.name === "origin") ?? remotes[0]
	const repoUrl = origin ? normalizeGitHubRemoteUrl(origin.url) : null
	if (!origin || !repoUrl) {
		return {}
	}
	return { repoUrl, branch: await remoteBranchForCheckout(cwd, origin.name) }
}

export async function getWorkspaceCloudDefaults(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<WorkspaceCloudDefaults> {
	const cwd = await getWorkspacePath()
	return WorkspaceCloudDefaults.create(cwd ? await resolveWorkspaceCloudDefaults(cwd) : {})
}
