import { GitCommit as ProtoGitCommit } from "@shared/proto/cline/file"
import { GitCommit } from "@utils/git"

/**
 * Converts domain GitCommit objects to proto GitCommit objects
 */
export function convertGitCommitsToProtoGitCommits(commits: GitCommit[]): ProtoGitCommit[] {
	return commits.map((commit) => ({
		hash: commit.hash,
		shortHash: commit.shortHash,
		subject: commit.subject,
		author: commit.author,
		date: commit.date,
	}))
}

/**
 * Converts proto GitCommit objects to domain GitCommit objects
 */
export function convertProtoGitCommitsToGitCommits(protoCommits: ProtoGitCommit[]): GitCommit[] {
	return protoCommits.map((protoCommit) => ({
		hash: protoCommit.hash,
		shortHash: protoCommit.shortHash,
		subject: protoCommit.subject,
		author: protoCommit.author,
		date: protoCommit.date,
	}))
}
