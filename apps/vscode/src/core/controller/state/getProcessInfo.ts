import { EmptyRequest } from "@shared/proto/cline/common"
import { ProcessInfo } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function getProcessInfo(_controller: Controller, _request: EmptyRequest): Promise<ProcessInfo> {
	return ProcessInfo.create({})
}
