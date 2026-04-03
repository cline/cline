import { PathHashMap } from "@shared/proto/cline/checkpoints"
import { StringArrayRequest } from "@shared/proto/cline/common"
import crypto from "crypto"
import { Controller } from ".."

function hashWorkingDir(dir: string): string {
	return crypto.createHash("sha256").update(dir).digest("hex").slice(0, 16)
}

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
