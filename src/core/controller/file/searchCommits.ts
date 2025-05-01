import { Controller } from ".."
import { GitCommitSearchResponse, GitCommit as ProtoGitCommit } from "@shared/proto/file"
import { StringRequest } from "@shared/proto/common"
import { searchCommits as searchCommitsUtil } from "@utils/git"
import { getWorkspacePath } from "@utils/path"
import { FileMethodHandler } from "./index"

/**
 * Searches for git commits in the workspace repository
 * @param controller The controller instance
 * @param request The request message containing the search query in the 'value' field
 * @returns GitCommitSearchResponse containing the matching commits
 */
export const searchCommits: FileMethodHandler = async (
	controller: Controller,
	request: StringRequest,
): Promise<GitCommitSearchResponse> => {
	const cwd = getWorkspacePath()
	if (!cwd) {
		return GitCommitSearchResponse.create({ commits: [] })
	}

	try {
		const commits = await searchCommitsUtil(request.value || "", cwd)

		// Map the domain GitCommit type to the proto GitCommit type
		const protoCommits: ProtoGitCommit[] = commits.map((commit) => ({
			hash: commit.hash,
			shortHash: commit.shortHash,
			subject: commit.subject,
			author: commit.author,
			date: commit.date,
		}))

		return GitCommitSearchResponse.create({ commits: protoCommits })
	} catch (error) {
		console.error(`Error searching commits: ${JSON.stringify(error)}`)
		return GitCommitSearchResponse.create({ commits: [] })
	}
}
