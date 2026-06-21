import { Empty } from "@shared/proto/cline/common"
import { ExecuteQuickWinRequest } from "@shared/proto/cline/task"
import type { Controller } from "../index"

export async function executeQuickWin(_controller: Controller, _request: ExecuteQuickWinRequest): Promise<Empty> {
	return Empty.create({})
}
