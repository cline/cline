import { RelativePaths, RelativePathsRequest } from "@shared/proto/cline/file"
import { Controller } from ".."

export async function getRelativePaths(_controller: Controller, _request: RelativePathsRequest): Promise<RelativePaths> {
	return RelativePaths.create({})
}
