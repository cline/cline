import { PathHashMap } from "@shared/proto/cline/checkpoints"
import { StringArrayRequest } from "@shared/proto/cline/common"
import { hashWorkingDir } from "@/integrations/checkpoints/CheckpointUtils"
import { Controller } from ".."

export async function getCwdHash(_controller: Controller, request: StringArrayRequest): Promise<PathHashMap> {
	const pathHash: Record<string, string> = {}

	for (const path of request.value) {
		try {
			pathHash[path] = hashWorkingDir(path)
		} catch {
			pathHash[path] = ""
		}
	}

	return PathHashMap.create({ pathHash })
}
