import { exec } from "node:child_process"
import { promisify } from "node:util"
import { normalizeGitHubRemoteUrl } from "@shared/cloud/cloud-sessions"
import { WorkspaceCloudDefaults } from "@shared/proto/cline/cloud"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { getGitRemoteUrls } from "@/utils/git"
import { getWorkspacePath } from "@/utils/path"
import type { Controller } from "../index"

const execAsync = promisify(exec)

/**
 * Suggests the repository and branch for a cloud task from the open workspace's
 * git remotes (preferring `origin`) and checked-out branch. Empty when the
 * workspace is not a GitHub repository.
 */
export async function getWorkspaceCloudDefaults(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<WorkspaceCloudDefaults> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorkspaceCloudDefaults.create({})
	}
	const remotes = (await getGitRemoteUrls(cwd)).map((line) => {
		const separator = line.indexOf(": ")
		return { name: line.slice(0, separator), url: line.slice(separator + 2) }
	})
	const origin = remotes.find((remote) => remote.name === "origin") ?? remotes[0]
	const repoUrl = origin ? normalizeGitHubRemoteUrl(origin.url) : null
	if (!repoUrl) {
		return WorkspaceCloudDefaults.create({})
	}
	let branch: string | undefined
	try {
		const { stdout } = await execAsync("git branch --show-current", { cwd })
		branch = stdout.trim() || undefined
	} catch {
		branch = undefined
	}
	return WorkspaceCloudDefaults.create({ repoUrl, branch })
}
