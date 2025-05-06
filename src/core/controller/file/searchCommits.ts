import { Controller } from ".."
import { GitCommits } from "@shared/proto/file"
import { StringRequest } from "@shared/proto/common"
import { searchCommits as searchCommitsUtil } from "@utils/git"
import { getWorkspacePath } from "@utils/path"
import { FileMethodHandler } from "./index"
import { convertGitCommitsToProtoGitCommits } from "@shared/proto-conversions/file/git-commit-conversion"

/**
 * Searches for git commits in the workspace repository
 * @param controller The controller instance
 * @param request The request message containing the search query in the 'value' field
 * @returns GitCommits containing the matching commits
 */
export const searchCommits: FileMethodHandler = async (controller: Controller, request: StringRequest): Promise<GitCommits> => {
	const cwd = getWorkspacePath()
	if (!cwd) {
		return GitCommits.create({ commits: [] })
	}

	try {
		const commits = await searchCommitsUtil(request.value || "", cwd)

		const protoCommits = convertGitCommitsToProtoGitCommits(commits)

		return GitCommits.create({ commits: protoCommits })
	} catch (error) {
		console.error(`Error searching commits: ${JSON.stringify(error)}`)
		return GitCommits.create({ commits: [] })
	}
}
