import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function accountLogoutClicked(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.authService.signOut()
	return Empty.create({})
}
