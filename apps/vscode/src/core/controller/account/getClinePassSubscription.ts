import { ClinePassSubscription } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function getClinePassSubscription(controller: Controller, _request: EmptyRequest): Promise<ClinePassSubscription> {
	return ClinePassSubscription.create({ subscribed: await controller.accountService.fetchClinePassSubscribedRPC() })
}
