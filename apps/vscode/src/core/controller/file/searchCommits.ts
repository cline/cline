import { StringRequest } from "@shared/proto/cline/common"
import { GitCommits } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function searchCommits(_controller: Controller, _request: StringRequest): Promise<GitCommits> {
	return GitCommits.create({})
}
