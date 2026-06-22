import { EmptyRequest } from "@shared/proto/cline/common"
import { RefreshedRules } from "@shared/proto/cline/file"
import type { Controller } from "../index"

export async function refreshRules(_controller: Controller, _request: EmptyRequest): Promise<RefreshedRules> {
	return RefreshedRules.create({})
}
